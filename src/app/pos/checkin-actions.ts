"use server";

import { assertStaff, hasAdminAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameOf, formatPhone, isFullPhone, last10 } from "@/lib/checkin";
import { CHECKIN_LIFETIME_MS, memberIdsWithPhone, memberIdWithEmail, openCheckin, saveNameFromCheckin, savePhoneFromCheckin } from "@/lib/checkin-server";
import { isPhoneAccount } from "@/lib/member-name";
import { sameEmail } from "@/lib/email-match";
import { allowAttempt } from "@/lib/rate-limit";
import { getPosMember, getPosMembers, type PosMember } from "./member-actions";
import { openRewards, recordVisit, redeemReward, todaysVisitors, undoVisitToday, unredeemReward, visitToday, type OpenReward, type VisitToday } from "@/lib/visits-server";
import { dailyCoffeeToday } from "@/lib/daily-perk-server";
import type { VisitResult } from "@/lib/visits";
import { issueClaimLink } from "@/lib/member-claim";
import { tabletDuplicateOf } from "@/lib/data/member-merge";
import { currentMemberId } from "@/lib/member-forward";
import { mergeHref } from "@/lib/member-merge";
import { setMarketingOptIn } from "@/lib/email/consent";
import { memberJoined } from "@/lib/email/automations";

// The register's half of check-in for points (the customer screen's half is
// in display/customer/actions.ts, which checks people in itself). Staff-only:
// this is where a sealed request from the screen turns into a photo, a full
// name and what staff need to know, with Undo for a mistake (undoCheckin);
// a shared family number still waits for staff to pick the face.

export type CheckinCard =
  // fresh: the tablet just made this account for a new customer.
  // phoneLast4: empty when they checked in with their email (byEmail).
  // addPhone: "(417) 555-1234", the number they said yes to adding at the
  // tablet (found by email, no phone on file): shown on the card so staff
  // know, and saved when staff check them in (confirmVisit).
  // addName: "Sarah M.", from the tablet's "Add your name?" (a phone account
  // with none yet): shown on the card, saved when staff check them in.
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
    }
  | {
      kind: "new";
      firstName: string;
      phone: string;
      email: string | null;
      emailOptIn: boolean;
      // The email they typed is already on this account (someone who joined
      // online without a phone, say): staff can attach them instead.
      emailMatch: PosMember | null;
    };

const EXPIRED = "This check-in timed out. Ask them to check in again on the screen.";
const OFFLINE = "Couldn't reach the database. Check the connection and try again.";
const BUSY = "Too many check-ins at once. Wait a minute, then try again.";

export async function resolveCheckin(ref: string): Promise<{ ok: true; card: CheckinCard } | { ok: false; error: string; expired?: boolean }> {
  const staff = await assertStaff();
  if (!(await allowAttempt(`checkin-resolve:${staff.employeeId}`, 30, 60))) return { ok: false, error: BUSY };
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
    if (!found.ok) return { ok: false, error: OFFLINE };
    // Usually one; a shared family number can have a few.
    const matches = (await Promise.all(found.ids.slice(0, 4).map((id) => getPosMember(id)))).filter((m): m is PosMember => !!m);
    if (!matches.length) return { ok: false, error: "No account has that number anymore. Look them up by name instead." };
    const age = Math.max(0, Math.round((Date.now() - (c.exp - CHECKIN_LIFETIME_MS)) / 1000));
    return { ok: true, card: { kind: "known", phoneLast4: c.phone.slice(-4), matches, fresh: c.fresh === true, age } };
  }

  const matchId = c.email ? await memberIdWithEmail(c.email) : null;
  return {
    ok: true,
    card: {
      kind: "new",
      firstName: c.firstName,
      phone: formatPhone(c.phone),
      email: c.email,
      emailOptIn: c.emailOptIn,
      emailMatch: matchId ? await getPosMember(matchId) : null,
    },
  };
}

export type CheckinCreated = { ok: true; member: PosMember; isNew: boolean; note: string | null } | { ok: false; error: string };

// "Create & attach" for a new regular: a free Insiders account with just a
// first name and the phone (plus the email, if they gave one -- opted in to
// emails only if they ticked the box). With `existingId` it's "Attach them"
// instead, for when the email they typed is on an account already: that
// account gets this phone if it has none on file.
export async function createCheckinMember(ref: string, existingId: string | null = null): Promise<CheckinCreated> {
  const staff = await assertStaff();
  if (!(await allowAttempt(`checkin-create:${staff.employeeId}`, 10, 300))) return { ok: false, error: BUSY };
  const c = openCheckin(ref);
  if (!c) return { ok: false, error: EXPIRED };
  if (c.kind !== "new") return { ok: false, error: "That check-in is for an existing account." };
  const supabase = createAdminClient();
  const phone = formatPhone(c.phone);

  if (existingId) {
    let m = await getPosMember(existingId);
    if (!m || !c.email || !sameEmail(m.email, c.email)) return { ok: false, error: "That account doesn't match the email they typed." };
    let note: string | null = null;
    if (!m.phone) {
      const { error } = await supabase.from("members").update({ phone }).eq("id", m.id).is("phone", null);
      if (error) note = "Couldn't save the phone on their account, but they're attached.";
      else {
        m = { ...m, phone };
        note = `Added ${phone} to ${firstNameOf(m.name)}'s account.`;
      }
    } else if (last10(m.phone) !== c.phone) {
      note = `Their account has a different phone on file (ending ${last10(m.phone).slice(-4)}), so it wasn't changed.`;
    }
    // They ticked "email me" just now, so honour it. (Never switches emails
    // off: leaving the box empty isn't a request to unsubscribe.)
    if (c.emailOptIn) await setMarketingOptIn(m.id, true, "kiosk", { byEmployee: staff.employeeId }).catch(() => null);
    return { ok: true, member: m, isNew: false, note };
  }

  // Made on another register a moment ago, or the same request twice:
  // attach that account rather than making a second one.
  const byPhone = await memberIdsWithPhone(c.phone);
  if (!byPhone.ok) return { ok: false, error: OFFLINE };
  if (byPhone.ids.length) {
    const m = await getPosMember(byPhone.ids[0]);
    if (m) return { ok: true, member: m, isNew: false, note: "That number already had an account, so that one is attached." };
  }

  // Emails are one account each. If theirs is taken (and staff chose "Create
  // new" over attaching that account), the new one is made without it.
  const EMAIL_TAKEN = "Their email is already on another account, so it wasn't saved on this one.";
  let email = c.email;
  let note: string | null = null;
  if (email && (await memberIdWithEmail(email))) {
    email = null;
    note = EMAIL_TAKEN;
  }
  const row = (withEmail: string | null) => ({
    name: c.firstName,
    phone,
    email: withEmail,
    email_opt_in: !!withEmail && c.emailOptIn,
    email_opt_in_changed_at: withEmail ? new Date().toISOString() : null,
  });
  let { data, error } = await supabase.from("members").insert(row(email)).select("id").single();
  if (error?.code === "23505" && email) {
    // Lost a race for the email (the unique index): same as above.
    ({ data, error } = await supabase.from("members").insert(row(null)).select("id").single());
    note = EMAIL_TAKEN;
  }
  if (error || !data) return { ok: false, error: "Couldn't create the account. Try again, or add them from Members in the back office." };
  // Their choice at the screen, with where it came from (lib/email/consent.ts);
  // a yes also queues the welcome email.
  const saved = await createAdminClient().from("members").select("email, email_opt_in").eq("id", data.id).maybeSingle();
  if (saved.data?.email) {
    await setMarketingOptIn(data.id, saved.data.email_opt_in !== false, "kiosk", { byEmployee: staff.employeeId }).catch(() => null);
    if (saved.data.email_opt_in !== false) memberJoined(data.id);
  }

  const member = await getPosMember(data.id);
  if (!member) return { ok: false, error: OFFLINE };
  return { ok: true, member, isNew: true, note };
}

// ---------- visits, badges and rewards (lib/visits.ts) ----------

// phoneNote: what happened to the phone they asked to add at the tablet
// ("Added (417) 555-1234 to their account."), or null if there wasn't one.
// nameNote: the same for the name from "Add your name?", and member: them
// with it, when it went on.
export type VisitConfirm =
  | { ok: true; visit: VisitResult; rewards: OpenReward[]; claimUrl: string | null; phoneNote: string | null; nameNote?: string | null; member?: PosMember | null }
  | { ok: false; error: string };

// A member confirmed at the door gets one "finish on your phone" link per
// this long (the tablet already made one if it just created the account).
const CLAIM_LINK_EVERY_MS = 10 * 60_000;

// Staff tapped Check in: today's visit, with its points and any new badges
// (and their rewards). Once a day per member; a repeat says so and pays
// nothing.
// A member with no website login also gets a claim link (lib/member-claim.ts)
// for the tablet to show as a QR code: only here, once staff have said it's
// them, never from the number typed at the screen alone. Not for anyone with
// billing on file (Insiders+, a Stripe customer): the code is up on a screen
// in front of the line, the link alone opens the account, and that account
// holds a billing portal. Theirs comes on their receipt, which is handed to
// them.
// Not for a phone account either (lib/member-name.ts: no email, no login):
// they chose just their number, so the tablet never pushes a login at them.
// Their receipt still carries the link, for anyone who wants one.
async function tabletClaimLink(memberId: string): Promise<string | null> {
  const { data: m } = await createAdminClient().from("members").select("tier, email, auth_user_id, stripe_customer_id, stripe_subscription_id").eq("id", memberId).maybeSingle();
  if (!m || m.tier === "Insiders+" || m.stripe_customer_id || m.stripe_subscription_id || isPhoneAccount(m)) return null;
  return issueClaimLink(memberId, "kiosk", { skipIfIssuedWithinMs: CLAIM_LINK_EVERY_MS });
}

// `ref`: the check-in's sealed request, when it came from the tablet. If
// they said yes there to adding the number they typed (found by email, no
// phone on file), it's saved now that staff have said it's them.
export async function confirmVisit(cardMemberId: string, ref: string | null = null): Promise<VisitConfirm> {
  const staff = await assertStaff();
  // Merged into another account since the card came up: that one.
  const memberId = (await currentMemberId(cardMemberId)) ?? cardMemberId;
  const visit = await recordVisit(memberId, staff.employeeId);
  if (!visit) return { ok: false, error: "Couldn't save the check-in. Try again." };
  const [rewards, claimUrl, phoneNote, named] = await Promise.all([
    openRewards(memberId),
    tabletClaimLink(memberId),
    typeof ref === "string" ? savePhoneFromCheckin(ref, memberId) : null,
    typeof ref === "string" ? saveNameFromCheckin(ref, memberId) : null,
  ]);
  const member = named?.saved ? await getPosMember(memberId).catch(() => null) : null;
  return { ok: true, visit, rewards, claimUrl, phoneNote, nameNote: named?.note ?? null, member };
}

// "Undo / Not them" on a check-in from the customer screen (it's already
// recorded and paid there): staff spotted a mistake. The visit it paid is
// taken back, points, badges and all (lib/visits-server.ts undoVisitToday).
// A check-in that paid nothing (they'd checked in earlier today) leaves
// that earlier visit alone. `ref`: the check-in's sealed request; once it's
// run out (15 minutes), today's visit is taken back on staff's word.
export async function undoCheckin(memberId: string, ref: string | null): Promise<{ ok: true; taken: number; note: string } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (!(await allowAttempt(`checkin-undo:${staff.employeeId}`, 20, 300))) return { ok: false, error: BUSY };
  const c = typeof ref === "string" ? openCheckin(ref) : null;
  const id = (await currentMemberId(memberId)) ?? memberId;
  if (c && c.kind === "known" && "memberId" in c && c.done && !c.paid) {
    return { ok: true, taken: 0, note: "They'd checked in earlier today, so that visit stays. They're off the order." };
  }
  const r = await undoVisitToday(id, staff.employeeId);
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
}

// Everyone who's checked in today, newest first: faces and names for the
// staff, and a quick way to put someone on an order when they buy later.
export async function getHereToday(): Promise<HereToday[]> {
  await assertStaff();
  const visits = await todaysVisitors();
  const members = await getPosMembers(visits.map((v) => v.memberId));
  const byId = new Map(members.map((m) => [m.id, m]));
  return visits.flatMap((v) => {
    const member = byId.get(v.memberId);
    return member ? [{ member, at: v.at, streak: v.streak }] : [];
  });
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
