"use server";

import { after } from "next/server";
import { assertDisplayScreen } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEmail, cleanFirstName, formatPhone, isFullPhone, last10, phoneDigits, type CheckinRequest } from "@/lib/checkin";
import { memberIdsWithPhone, memberWithEmail, sealCheckin, type EmailMatch } from "@/lib/checkin-server";
import { allowAttempt, TOO_MANY_TRIES } from "@/lib/rate-limit";
import { issueClaimLink } from "@/lib/member-claim";
import { legacyNeedsSetup } from "@/lib/legacy-plus";
import { shortName } from "@/lib/card-match";
import { emailConfigured } from "@/lib/email/send";
import { emailSetupLinkToNewMember } from "@/lib/sign-in-help";
import { hasName } from "@/lib/member-name";
import { visitBusinessDate } from "@/lib/visits";

// Check-in for points, from the customer screen. The screen page is gated by
// requireDisplayScreen() (a physical device, signed in with its display-only
// login or a staff one), and assertDisplayScreen() re-checks here so these
// can't be called by anyone else.
//
// "Phone or email" (Andrew, 10/1): about half the members have no usable
// phone on file but nearly all have an email, so the tablet looks people up
// by either.
// - A known number gets back a sealed request for the register, where staff
//   see who it is and confirm. Nothing about them comes back.
// - A known email gets the sealed request too, plus a first name and last
//   initial for "Welcome back, Sarah M.!" (Andrew chose the friendlier
//   screen: points have little cash value). Never anything else.
// - Anything unknown just hears "new".

// unlimited: the account is a former unlimited member's with nothing paying
// for it here (lib/legacy-plus.ts): the screen tells them their card goes
// on at the register. Nothing else about them comes back.
// askName: a phone account with no name yet, back for its second visit:
// the screen asks once, gently, "Add your name?" (nameCheckin), and skipping
// sends `request` as it is. Nothing else about them comes back.
export type CheckinStart =
  | { ok: true; status: "known"; request: CheckinRequest; unlimited?: true; askName?: true }
  | { ok: true; status: "new" }
  | { ok: false; error: string };

// Found by email. name: "Sarah M.". withPhone: the same check-in, also
// adding the number they typed earlier (their account has none, and no
// other account has it), saved only when staff confirm; phone is that
// number, formatted, for the offer.
export type CheckinFound = {
  ok: true;
  status: "found";
  name: string;
  request: CheckinRequest;
  withPhone?: CheckinRequest;
  phone?: string;
  unlimited?: true;
};

export type EmailStart = CheckinFound | { ok: true; status: "new" } | { ok: false; error: string };

const NOT_A_NUMBER = "That doesn't look like a full phone number. Try again?";
const NOT_AN_EMAIL = "That email doesn't look right. Check it and try again?";
const LOOKUP_FAILED = "We couldn't look that up just now. Ask a staff member for help.";
// One letter, any alphabet (the RegExp constructor: \p{} needs a newer
// target than this project compiles to).
const ONE_LETTER = new RegExp("^\\p{L}$", "u");

// Anyone at the tablet can type, so lookups are capped per signed-in screen,
// on top of the screen's own lockout. Roomy enough for a group checking in
// one after another at the door. Phone and email share the cap.
const lookupAllowed = (employeeId: string) => allowAttempt(`checkin-lookup:${employeeId}`, 30, 60);

export async function startCheckin(phone: string): Promise<CheckinStart> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: true, status: "new" };
  // No claim link here, even for a member with no login: the link alone
  // opens the account. Theirs comes after staff confirm it's them
  // (confirmVisit in pos/checkin-actions.ts), or on their receipt.
  const request = sealCheckin({ kind: "known", phone: digits });
  if (await unlimitedWithoutCard(found.ids)) return { ok: true, status: "known", request, unlimited: true };
  return found.ids.length === 1 && (await namelessToAsk(found.ids[0])) ? { ok: true, status: "known", request, askName: true } : { ok: true, status: "known", request };
}

// A phone account (lib/member-name.ts) with no name, on its second visit:
// one earlier day checked in, and none today. So it's asked once: after
// this visit there are two, and a skip never asks again. False whenever it
// can't tell.
async function namelessToAsk(memberId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: m, error } = await admin.from("members").select("name").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (error || !m || hasName(m.name as string | null)) return false;
  const { data: visits, error: vErr } = await admin.from("member_visits").select("business_date").eq("member_id", memberId).limit(2);
  if (vErr || visits?.length !== 1) return false;
  return visits[0].business_date !== visitBusinessDate(new Date());
}

// "Add your name?" answered: the number they typed (again, so nothing about
// the account rides on the screen) and a first name and last initial. The
// name goes on only when staff confirm the check-in, only onto that
// account, and only while it still has none (savePhoneFromCheckin's twin,
// lib/checkin-server.ts saveNameFromCheckin). An account that isn't a
// nameless one any more just checks in as it is.
export async function nameCheckin(fields: { phone: string; firstName: string; lastInitial?: string | null }): Promise<{ ok: true; request: CheckinRequest; firstName: string } | { ok: false; error: string }> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(String(fields?.phone ?? ""));
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  const firstName = cleanFirstName(String(fields?.firstName ?? ""));
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const initial = String(fields?.lastInitial ?? "")
    .trim()
    .replace(/\.$/, "");
  if (initial && !ONE_LETTER.test(initial)) return { ok: false, error: "Just the first letter of your last name, or leave it blank." };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: false, error: "We couldn't find that number just now. Ask a staff member for help." };
  if (found.ids.length > 1) return { ok: true, request: sealCheckin({ kind: "known", phone: digits }), firstName };
  const name = initial ? `${firstName} ${initial.toLocaleUpperCase()}.` : firstName;
  return { ok: true, request: sealCheckin({ kind: "known", memberId: found.ids[0], phone: digits, addName: name }), firstName };
}

// The email they typed. `phone`: a number they tried first that we didn't
// find, for the "add this phone" offer.
export async function startEmailCheckin(fields: { email: string; phone?: string | null }): Promise<EmailStart> {
  const screen = await assertDisplayScreen();
  const email = cleanEmail(String(fields.email ?? ""));
  if (!email) return { ok: false, error: NOT_AN_EMAIL };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberWithEmail(email);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (!found.member) return { ok: true, status: "new" };
  return foundByEmail(found.member, typedPhone(fields.phone));
}

function typedPhone(raw: string | null | undefined): string | null {
  const d = phoneDigits(String(raw ?? ""));
  return isFullPhone(d) ? d : null;
}

// "Welcome back, Sarah M.!", the sealed request, and the offer to add the
// number they typed when their account has no usable phone and nobody
// else's has that number.
async function foundByEmail(m: EmailMatch, digits: string | null): Promise<CheckinFound> {
  let addPhone: string | null = null;
  if (digits && !isFullPhone(last10(m.phone))) {
    const taken = await memberIdsWithPhone(digits);
    if (taken.ok && taken.ids.length === 0) addPhone = digits;
  }
  const request = sealCheckin({ kind: "known", memberId: m.id });
  const withPhone = addPhone ? sealCheckin({ kind: "known", memberId: m.id, addPhone }) : null;
  const unlimited = await unlimitedWithoutCard([m.id]);
  return {
    ok: true,
    status: "found",
    name: shortName(m.name),
    request,
    ...(withPhone && addPhone ? { withPhone, phone: formatPhone(addPhone) } : {}),
    ...(unlimited ? { unlimited: true as const } : {}),
  };
}

// Every account here paid for unlimited on the old site and has nothing
// paying for it here (usually there's one; a shared family number only
// counts when it's true of all of them, so nobody is told about someone
// else's membership). False whenever it can't tell.
async function unlimitedWithoutCard(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  // "*": works before and after the onboarding migration adds its column.
  const { data, error } = await createAdminClient().from("members").select("*").in("id", ids.slice(0, 8));
  if (error || !data?.length) return false;
  return data.every((m) => legacyNeedsSetup({ ...m, comped: !!m.comped }));
}

// A number we don't know: the customer gave a first name (and maybe an
// email). Nothing is saved yet -- the register's "Create & attach" does that
// once staff have seen them. Email opt-in stays off unless they ticked it.
export async function startNewCheckin(fields: { phone: string; firstName: string; email: string; emailOptIn: boolean }): Promise<{ ok: true; request: CheckinRequest } | { ok: false; error: string }> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(fields.phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  const firstName = cleanFirstName(fields.firstName);
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const email = fields.email.trim() ? cleanEmail(fields.email) : null;
  if (fields.email.trim() && !email) return { ok: false, error: "That email doesn't look right. Fix it, or leave it blank." };
  if (!(await allowAttempt(`checkin-new:${screen.employeeId}`, 5, 60))) return { ok: false, error: TOO_MANY_TRIES };

  // Someone may have signed up with this number since the lookup: then it's
  // an ordinary check-in, confirmed by photo at the register.
  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length > 0) return { ok: true, request: sealCheckin({ kind: "known", phone: digits }) };

  return {
    ok: true,
    request: sealCheckin({ kind: "new", phone: digits, firstName, email, emailOptIn: !!email && fields.emailOptIn === true }),
  };
}

// emailed: a setup link is on its way to their inbox (sent just after this
// answers, so the line doesn't wait on it).
export type KioskCreate =
  | { ok: true; status: "known"; request: CheckinRequest }
  | CheckinFound
  | { ok: true; status: "created"; request: CheckinRequest; firstName: string; claimUrl: string | null; emailed: boolean }
  | { ok: false; error: string };

// Someone new, at the door: the account is made right away from their name
// and email (phone optional), so the next person doesn't wait on the
// bartender. Staff still confirm the visit on the register (that's what pays
// points, the Welcome badge's included), and they see "New regular" with
// the name. They finish the rest (password, photo) on their own phone, from
// the QR code here or the setup link emailed to them now. Email marketing
// stays off: the setup email is about their account, not a list.
// An email or number that's on an account already (typed here, or signed
// up since) checks in that account instead of making a second one.
export async function createKioskMember(fields: { firstName: string; lastName: string; email: string; phone?: string | null }): Promise<KioskCreate> {
  const screen = await assertDisplayScreen();
  const firstName = cleanFirstName(String(fields.firstName ?? ""));
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const lastName = cleanFirstName(String(fields.lastName ?? ""));
  if (!lastName) return { ok: false, error: "Type your last name (letters only)." };
  const email = cleanEmail(String(fields.email ?? ""));
  if (!email) return { ok: false, error: NOT_AN_EMAIL };
  const rawPhone = phoneDigits(String(fields.phone ?? ""));
  if (rawPhone && !isFullPhone(rawPhone)) return { ok: false, error: "That phone number doesn't look right. Fix it, or leave it blank." };
  const digits = rawPhone || null;
  if (!(await allowAttempt(`checkin-create:${screen.employeeId}`, 8, 60))) return { ok: false, error: TOO_MANY_TRIES };

  const byEmail = await memberWithEmail(email);
  if (!byEmail.ok) return { ok: false, error: LOOKUP_FAILED };
  if (byEmail.member) return foundByEmail(byEmail.member, digits);
  if (digits) {
    const byPhone = await memberIdsWithPhone(digits);
    if (!byPhone.ok) return { ok: false, error: LOOKUP_FAILED };
    if (byPhone.ids.length > 0) return { ok: true, status: "known", request: sealCheckin({ kind: "known", phone: digits }) };
  }

  const { data, error } = await createAdminClient()
    .from("members")
    .insert({ name: `${firstName} ${lastName}`, phone: digits ? formatPhone(digits) : null, email, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  if (error?.code === "23505") {
    // Their email went on an account a moment ago (the other screen, say).
    const again = await memberWithEmail(email);
    if (again.ok && again.member) return foundByEmail(again.member, digits);
  }
  if (error || !data) return { ok: false, error: "We couldn't set that up just now. Ask the box office to add you." };
  const memberId = data.id as string;

  // The "finish on your phone" QR code: a 30-minute claim link (lib/
  // member-claim.ts). Null if it can't be made: the screen then just says
  // welcome. And the setup link by email, good for 30 days.
  const claimUrl = await issueClaimLink(memberId, "kiosk");
  const emailed = emailConfigured();
  if (emailed) {
    after(async () => {
      await emailSetupLinkToNewMember(memberId);
    });
  }
  return {
    ok: true,
    status: "created",
    request: sealCheckin({ kind: "known", memberId, ...(digits ? { phone: digits } : {}), fresh: true }),
    firstName,
    claimUrl,
    emailed,
  };
}

// "Just use my phone number" (Andrew, 10/2): a number we don't know becomes
// a phone account (lib/member-name.ts), nothing but the number. No name, no
// email, email marketing off, no setup link, no QR code: they just type
// the number each time. Staff still confirm the visit at the register,
// which pays its points (the Welcome badge's included), as for anyone new.
// A number that's on an account by now checks that account in instead.
export async function createPhoneAccount(phone: string): Promise<{ ok: true; request: CheckinRequest; made: boolean } | { ok: false; error: string }> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(String(phone ?? ""));
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  if (!(await allowAttempt(`checkin-create:${screen.employeeId}`, 8, 60))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length > 0) return { ok: true, request: sealCheckin({ kind: "known", phone: digits }), made: false };

  const { data, error } = await createAdminClient()
    .from("members")
    .insert({ name: "", phone: formatPhone(digits), email: null, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "We couldn't set that up just now. Ask the box office to add you." };
  return { ok: true, request: sealCheckin({ kind: "known", memberId: data.id as string, phone: digits, fresh: true }), made: true };
}
