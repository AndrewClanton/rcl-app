"use server";

import { assertStaff, hasAdminAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameOf, formatPhone, last10 } from "@/lib/checkin";
import { memberIdsWithPhone, memberIdWithEmail, openCheckin } from "@/lib/checkin-server";
import { sameEmail } from "@/lib/email-match";
import { allowAttempt } from "@/lib/rate-limit";
import { getPosMember, getPosMembers, type PosMember } from "./member-actions";
import { openRewards, recordVisit, redeemReward, todaysVisitors, unredeemReward, type OpenReward } from "@/lib/visits-server";
import type { VisitResult } from "@/lib/visits";
import { issueClaimLink } from "@/lib/member-claim";
import { tabletDuplicateOf } from "@/lib/data/member-merge";
import { currentMemberId } from "@/lib/member-forward";
import { mergeHref } from "@/lib/member-merge";
import { setMarketingOptIn } from "@/lib/email/consent";
import { memberJoined } from "@/lib/email/automations";

// The register's half of check-in for points (the customer screen's half is
// in display/customer/actions.ts). Staff-only: this is where a sealed
// request from the screen turns into a photo, a full name and the last four
// of the phone, for staff to say "yes, that's them" before anything is
// attached or created.

export type CheckinCard =
  // fresh: the tablet just made this account for a new customer.
  | { kind: "known"; phoneLast4: string; matches: PosMember[]; fresh?: boolean }
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

  if (c.kind === "known") {
    const found = await memberIdsWithPhone(c.phone);
    if (!found.ok) return { ok: false, error: OFFLINE };
    // Usually one; a shared family number can have a few.
    const matches = (await Promise.all(found.ids.slice(0, 4).map((id) => getPosMember(id)))).filter((m): m is PosMember => !!m);
    if (!matches.length) return { ok: false, error: "No account has that number anymore. Look them up by name instead." };
    return { ok: true, card: { kind: "known", phoneLast4: c.phone.slice(-4), matches, fresh: c.fresh === true } };
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

export type VisitConfirm = { ok: true; visit: VisitResult; rewards: OpenReward[]; claimUrl: string | null } | { ok: false; error: string };

// A member confirmed at the door gets one "finish on your phone" link per
// this long (the tablet already made one if it just created the account).
const CLAIM_LINK_EVERY_MS = 10 * 60_000;

// Staff tapped Check in: today's visit, with its points and any new badges
// (and their rewards). Once a day per member; a repeat says so and pays
// nothing.
// A member with no website login also gets a claim link (lib/member-claim.ts)
// for the tablet to show as a QR code: only here, once staff have said it's
// them, never from the number typed at the screen alone. Not for anyone with
// billing on file (Insiders+, a Stripe customer): they just typed their whole
// number in front of the line, so someone behind them knows the last four
// the claim page asks for, and the account holds a billing portal. Theirs
// comes on their receipt, which is handed to them.
async function tabletClaimLink(memberId: string): Promise<string | null> {
  const { data: m } = await createAdminClient().from("members").select("tier, stripe_customer_id, stripe_subscription_id").eq("id", memberId).maybeSingle();
  if (!m || m.tier === "Insiders+" || m.stripe_customer_id || m.stripe_subscription_id) return null;
  return issueClaimLink(memberId, "kiosk", { skipIfIssuedWithinMs: CLAIM_LINK_EVERY_MS });
}

export async function confirmVisit(cardMemberId: string): Promise<VisitConfirm> {
  const staff = await assertStaff();
  // Merged into another account since the card came up: that one.
  const memberId = (await currentMemberId(cardMemberId)) ?? cardMemberId;
  const visit = await recordVisit(memberId, staff.employeeId);
  if (!visit) return { ok: false, error: "Couldn't save the check-in. Try again." };
  const [rewards, claimUrl] = await Promise.all([openRewards(memberId), tabletClaimLink(memberId)]);
  return { ok: true, visit, rewards, claimUrl };
}

// After a check-in: an account the tablet made lately that's probably a
// second account for an older member with the same name and no usable
// phone (lib/data/member-merge.ts). The register only shows a line, with a
// link to review it in Back office for an owner or admin (the merge page
// is theirs; anyone else gets the line without the link). Nothing is
// merged from here. Null almost always, and whenever it can't tell.
export async function getDuplicateHint(memberId: string): Promise<{ href: string | null } | null> {
  const staff = await assertStaff();
  const hit = await tabletDuplicateOf(memberId);
  if (!hit) return null;
  return { href: hasAdminAccess(staff.role) ? mergeHref(hit.olderId, memberId) : null };
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
