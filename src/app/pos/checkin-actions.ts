"use server";

import { assertStaff, hasAdminAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhone, isFullPhone, last10 } from "@/lib/checkin";
import { CHECKIN_LIFETIME_MS, memberIdsWithPhone, openCheckin } from "@/lib/checkin-server";
import { allowAttempt } from "@/lib/rate-limit";
import { getPosMember, getPosMembers, type PosMember } from "./member-actions";
import { openRewards, redeemReward, todaysVisitors, undoVisit, unredeemReward, visitToday, type OpenReward, type VisitToday } from "@/lib/visits-server";
import { addFlag, flaggedAmong, memberFlags } from "@/lib/member-flags-server";
import { FLAG_NOTE_MAX, isFlagReason, type FlagReason } from "@/lib/member-flags";
import { addNote, memberNotes, memberOrganization, organizationsAmong, organizationsInUse, setOrganization } from "@/lib/member-notes-server";
import { cleanNote, type MemberNote } from "@/lib/member-notes";
import { dailyCoffeeToday } from "@/lib/daily-perk-server";
import { visitBusinessDate } from "@/lib/visits";
import { tabletDuplicateOf } from "@/lib/data/member-merge";
import { currentMemberId } from "@/lib/member-forward";
import { mergeHref } from "@/lib/member-merge";

// The register's half of check-in for points (the customer screen's half is
// in display/customer/actions.ts, which checks people in itself). Staff-only:
// this is where a sealed request from the screen turns into a photo, a full
// name and what staff need to know, with Undo for a mistake (undoCheckin).
// Nothing waits on staff: a shared family number picks "Which one is you?"
// on the screen itself (Andrew, 10/2).

export type CheckinCard =
  // fresh: the tablet just made this account for a new customer.
  // phoneLast4: empty when they checked in with their email (byEmail).
  // addPhone: "(417) 555-1234", the number they said yes to adding at the
  // tablet (found by email, no phone on file), and addName: "Sarah M.",
  // from the tablet's "Add your name?": on a request that isn't done yet
  // (both are saved with the check-in at the screen).
  // done: checked in at the screen already (its visit recorded and paid
  // there): the register just shows who it is, with Undo. paid: that
  // check-in paid today's visit (not a second one today). today: what the
  // visit paid, for the pop-up. coffee: an Insiders+ member's free coffee
  // today.
  | {
      kind: "known";
      phoneLast4: string;
      matches: PosMember[];
      fresh?: boolean;
      byEmail?: boolean;
      addPhone?: string | null;
      addName?: string | null;
      done?: boolean;
      paid?: boolean;
      today?: VisitToday | null;
      coffee?: "ready" | "used" | null;
      // Seconds since they checked in at the screen: a register that opens
      // later still shows it, but doesn't put them on a new order.
      age?: number;
    };

const EXPIRED = "This check-in timed out. Ask them to check in again on the screen.";
const OFFLINE = "Couldn't reach the database. Check the connection and try again.";
const BUSY = "Too many check-ins at once. Wait a minute, then try again.";

// retry: worth trying again in a moment (busy, or the database didn't answer).
export async function resolveCheckin(ref: string): Promise<{ ok: true; card: CheckinCard } | { ok: false; error: string; expired?: boolean; retry?: boolean }> {
  const staff = await assertStaff();
  if (!(await allowAttempt(`checkin-resolve:${staff.employeeId}`, 30, 60))) return { ok: false, error: BUSY, retry: true };
  const c = openCheckin(ref);
  if (!c) return { ok: false, error: EXPIRED, expired: true };

  if (c.kind === "known" && "memberId" in c) {
    // One account: checked in at the tablet (done), or found by email
    // there, or just made there. Merged into another account since: that one.
    const m = await getPosMember((await currentMemberId(c.memberId)) ?? c.memberId);
    if (!m) return { ok: false, error: "That account isn't there anymore. Look them up by name instead." };
    const phoneLast4 = c.phone ? c.phone.slice(-4) : "";
    const age = Math.max(0, Math.round((Date.now() - (c.exp - CHECKIN_LIFETIME_MS)) / 1000));
    if (c.done) {
      const [today, coffee] = await Promise.all([visitToday(m.id), m.tier === "Insiders+" ? dailyCoffeeToday(m.id).catch(() => null) : null]);
      return {
        ok: true,
        card: {
          kind: "known",
          phoneLast4,
          matches: [m],
          fresh: c.fresh === true,
          byEmail: !c.phone,
          done: true,
          paid: c.paid === true,
          today,
          coffee: coffee ? (coffee.usedAt ? "used" : "ready") : null,
          age,
        },
      };
    }
    const addPhone = c.addPhone && !isFullPhone(last10(m.phone)) ? formatPhone(c.addPhone) : null;
    const addName = c.addName && m.named === false ? c.addName : null;
    return {
      ok: true,
      card: { kind: "known", phoneLast4, matches: [m], fresh: c.fresh === true, byEmail: !c.phone, addPhone, addName, age },
    };
  }

  if (c.kind === "known") {
    const found = await memberIdsWithPhone(c.phone);
    if (!found.ok) return { ok: false, error: OFFLINE, retry: true };
    // Usually one; a shared family number can have a few.
    const matches = (await Promise.all(found.ids.slice(0, 4).map((id) => getPosMember(id)))).filter((m): m is PosMember => !!m);
    if (!matches.length) return { ok: false, error: "No account has that number anymore. Look them up by name instead." };
    const age = Math.max(0, Math.round((Date.now() - (c.exp - CHECKIN_LIFETIME_MS)) / 1000));
    return { ok: true, card: { kind: "known", phoneLast4: c.phone.slice(-4), matches, fresh: c.fresh === true, age } };
  }

  // Someone new, from a screen that left making the account to staff: the
  // screen makes it itself now (display/customer/actions.ts), so this one's
  // simply let go.
  return { ok: false, error: EXPIRED, expired: true };
}

// ---------- visits, badges and rewards (lib/visits.ts) ----------

// "That's not me" under their card on the customer screen, relayed by the
// register (the guest's own button: the register has no reversal buttons,
// Andrew 10/2). The check-in's visit is taken back, points, badges and all
// (lib/visits-server.ts undoVisit). A check-in that paid nothing (they'd
// checked in earlier today) leaves that earlier visit alone. `ref`: the
// check-in's sealed request; once it's run out (15 minutes), today's visit
// is taken back as it is.
export async function undoCheckin(memberId: string, ref: string | null): Promise<{ ok: true; taken: number; note: string } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!(await allowAttempt(`checkin-undo:${staff.employeeId}`, 20, 300))) return { ok: false, error: BUSY };
  const c = typeof ref === "string" ? openCheckin(ref) : null;
  const id = (await currentMemberId(memberId)) ?? memberId;
  if (c && c.kind === "known" && "memberId" in c && c.done && !c.paid) {
    return { ok: true, taken: 0, note: "They'd checked in earlier today, so that visit stays. They're off the order." };
  }
  const r = await undoVisit(id, staff.employeeId);
  if (!r) return { ok: false, error: "There's no check-in today to undo, or it couldn't be read. Try again." };
  return { ok: true, taken: r.taken, note: r.taken > 0 ? `Check-in undone: ${r.taken} point${r.taken === 1 ? "" : "s"} taken back.` : "Check-in undone." };
}

// After a check-in: an account the tablet made lately (by phone, or by
// email with no phone) that's probably a second account for an older
// member with the same email, or the same name and no usable phone
// (lib/data/member-merge.ts). The register only shows a line, with a
// link to review it in Back office for an owner or admin (the merge page
// is theirs; anyone else gets the line without the link). Nothing is
// merged from here. Null almost always, and whenever it can't tell.
// unlimited: the older account paid for unlimited on the old site and has
// nothing paying here (lib/legacy-plus.ts); the register can open it to set
// that up. Most of those have no phone on file, which is why the tablet
// made a new account.
export async function getDuplicateHint(memberId: string): Promise<{ href: string | null; olderId: string; unlimited: boolean } | null> {
  const staff = await assertStaff();
  const hit = await tabletDuplicateOf(memberId);
  if (!hit) return null;
  const older = await getPosMember(hit.olderId).catch(() => null);
  return { href: hasAdminAccess(staff.role) ? mergeHref(hit.olderId, memberId) : null, olderId: hit.olderId, unlimited: !!older?.legacyUnlimited };
}

export interface HereToday {
  member: PosMember;
  at: string;
  streak: number | null; // weeks in a row, as of today's visit
  flagged: boolean; // a flag on the account that isn't cleared (lib/member-flags.ts)
  organization: string | null; // their "Group / organization" label (lib/member-notes.ts), staff only
}

// Everyone who's checked in today, newest first: faces and names for the
// staff, and a quick way to put someone on an order when they buy later.
export async function getHereToday(): Promise<HereToday[]> {
  await assertStaff();
  const visits = await todaysVisitors();
  const ids = visits.map((v) => v.memberId);
  const [members, flagged, orgs] = await Promise.all([getPosMembers(ids), flaggedAmong(ids), organizationsAmong(ids)]);
  const byId = new Map(members.map((m) => [m.id, m]));
  return visits.flatMap((v) => {
    const member = byId.get(v.memberId);
    return member ? [{ member, at: v.at, streak: v.streak, flagged: flagged.has(v.memberId), organization: orgs.get(v.memberId) ?? null }] : [];
  });
}

// A long press on a customer card (MemberGlance.tsx): when they joined, how
// many visits, the last one before today, today's check-in time, and the
// latest flag on the account that isn't cleared. Null if it couldn't be
// read.
export interface GlanceFlag {
  by: string | null;
  at: string;
}

export interface MemberGlanceInfo {
  since: string | null;
  visits: number;
  lastVisit: string | null; // a business date, "2026-09-28"
  todayAt: string | null;
  flag: GlanceFlag | null;
  // Staff-only account notes (the latest few, newest first) and the
  // "Group / organization" label, with the ones in use as suggestions.
  notes: MemberNote[];
  organization: string | null;
  organizations: string[];
}

export async function getMemberGlance(memberId: string): Promise<MemberGlanceInfo | null> {
  await assertStaff();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return null;
  const supabase = createAdminClient();
  const today = visitBusinessDate(new Date());
  const [m, count, before, now, flags, notes, organization, organizations] = await Promise.all([
    supabase.from("members").select("created_at").eq("id", memberId).maybeSingle(),
    supabase.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    supabase.from("member_visits").select("business_date").eq("member_id", memberId).lt("business_date", today).order("business_date", { ascending: false }).limit(1),
    supabase.from("member_visits").select("checked_in_at").eq("member_id", memberId).eq("business_date", today).maybeSingle(),
    memberFlags(memberId, true),
    memberNotes(memberId, 5),
    memberOrganization(memberId),
    organizationsInUse(),
  ]);
  if (m.error || count.error || before.error || now.error) return null;
  return {
    since: (m.data?.created_at as string | undefined) ?? null,
    visits: count.count ?? 0,
    lastVisit: (before.data?.[0]?.business_date as string | undefined) ?? null,
    todayAt: (now.data?.checked_in_at as string | undefined) ?? null,
    flag: flags[0] ? { by: flags[0].flaggedBy, at: flags[0].flaggedAt } : null,
    notes,
    organization,
    organizations: organizations.slice(0, 30),
  };
}

// "Flag suspicious activity" in that panel (Andrew, 10/2): instead of
// reversing anything at the register, staff flag the account for an admin
// or owner to look at in Back office. It records who (`employeeId`: the
// cashier on the register, else the signed-in staff account), when, the
// reason, a short note, and today's check-in if there is one. It blocks
// nothing here.
export async function flagMember(
  memberId: string,
  fields: { reason: FlagReason; note?: string | null },
  employeeId: string | null,
): Promise<{ ok: true; flag: GlanceFlag } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!isFlagReason(fields?.reason)) return { ok: false, error: "Pick a reason." };
  const note = String(fields.note ?? "").trim().replace(/\s+/g, " ").slice(0, FLAG_NOTE_MAX) || null;
  if (!(await allowAttempt(`member-flag:${staff.employeeId}`, 10, 300))) return { ok: false, error: BUSY };
  const id = (await currentMemberId(memberId)) ?? memberId;
  const by = await registerEmployee(staff.employeeId, employeeId);
  const flag = await addFlag(id, fields.reason, note, by);
  if (!flag) return { ok: false, error: "Couldn't save the flag. Try again." };
  return { ok: true, flag: { by: flag.flaggedBy, at: flag.flaggedAt } };
}

const TOO_FAST = "Too many changes at once. Wait a minute, then try again.";

// The cashier picked on the register, if that's a real employee; else the
// signed-in staff account.
async function registerEmployee(signedIn: string | null, employeeId: string | null): Promise<string | null> {
  if (typeof employeeId === "string" && /^[0-9a-f-]{36}$/i.test(employeeId) && employeeId !== signedIn) {
    const { data } = await createAdminClient().from("employees").select("id").eq("id", employeeId).maybeSingle();
    if (data) return employeeId;
  }
  return signedIn;
}

// "Add a note" in that panel (Andrew, 10/5): any cashier, no PIN. Staff
// only (lib/member-notes.ts). Who: the cashier on the register.
export async function addMemberNote(
  memberId: string,
  text: string,
  employeeId: string | null,
): Promise<{ ok: true; note: MemberNote } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!cleanNote(text)) return { ok: false, error: "Type a note first." };
  if (!(await allowAttempt(`member-note:${staff.employeeId}`, 30, 300))) return { ok: false, error: TOO_FAST };
  const id = (await currentMemberId(memberId)) ?? memberId;
  const note = await addNote(id, text, await registerEmployee(staff.employeeId, employeeId));
  return note ? { ok: true, note } : { ok: false, error: "Couldn't save the note. Try again." };
}

// The organization chip in that panel: sets it, or clears it when empty.
// Returns the label as saved.
export async function setMemberOrganization(memberId: string, value: string): Promise<{ ok: true; organization: string | null } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!(await allowAttempt(`member-org:${staff.employeeId}`, 30, 300))) return { ok: false, error: TOO_FAST };
  const id = (await currentMemberId(memberId)) ?? memberId;
  const org = await setOrganization(id, value);
  return org === undefined ? { ok: false, error: "Couldn't save that. Try again." } : { ok: true, organization: org };
}

export async function getMemberRewards(memberId: string): Promise<OpenReward[]> {
  await assertStaff();
  return openRewards(memberId);
}

// Redeem puts the reward on the order at $0; Undo gives it back.
export async function redeemMemberReward(id: string): Promise<boolean> {
  const staff = await assertStaff();
  return redeemReward(id, staff.employeeId);
}

export async function undoMemberReward(id: string): Promise<void> {
  await assertStaff();
  await unredeemReward(id);
}
