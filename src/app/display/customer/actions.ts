"use server";

import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEmail, cleanFirstName, formatPhone, isFullPhone, phoneDigits, type CheckinRequest } from "@/lib/checkin";
import { memberIdsWithPhone, sealCheckin } from "@/lib/checkin-server";
import { allowAttempt, TOO_MANY_TRIES } from "@/lib/rate-limit";
import { issueClaimLink } from "@/lib/member-claim";

// Check-in for points, from the customer screen. The screen page is gated by
// requireStaff() (a physical, staff-set-up device), and assertStaff()
// re-checks here so these can't be called directly. Neither ever returns a
// member's details: a known number gets back a sealed request for the
// register, where staff see who it is and confirm; an unknown one just
// hears "new", so the screen can ask for a first name.

export type CheckinStart = { ok: true; status: "known"; request: CheckinRequest } | { ok: true; status: "new" } | { ok: false; error: string };

const NOT_A_NUMBER = "That doesn't look like a full phone number. Try again?";
const LOOKUP_FAILED = "We couldn't look that up just now. Ask a staff member for help.";

export async function startCheckin(phone: string): Promise<CheckinStart> {
  const staff = await assertStaff();
  const digits = phoneDigits(phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  // Anyone at the tablet can type numbers, so the lookup is capped per
  // signed-in screen, on top of the screen's own lockout.
  // Roomy enough for a group checking in one after another at the door.
  if (!(await allowAttempt(`checkin-lookup:${staff.employeeId}`, 30, 60))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: true, status: "new" };
  // No claim link here, even for a member with no login: whoever is at the
  // screen just typed the whole number, so the claim page's "last four of
  // your phone" check would prove nothing and anyone who knows a regular's
  // number could take their account. Theirs comes after staff confirm it's
  // them (confirmVisit in pos/checkin-actions.ts), or on their receipt.
  return { ok: true, status: "known", request: sealCheckin({ kind: "known", phone: digits }) };
}

// A number we don't know: the customer gave a first name (and maybe an
// email). Nothing is saved yet -- the register's "Create & attach" does that
// once staff have seen them. Email opt-in stays off unless they ticked it.
export async function startNewCheckin(fields: { phone: string; firstName: string; email: string; emailOptIn: boolean }): Promise<{ ok: true; request: CheckinRequest } | { ok: false; error: string }> {
  const staff = await assertStaff();
  const digits = phoneDigits(fields.phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  const firstName = cleanFirstName(fields.firstName);
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const email = fields.email.trim() ? cleanEmail(fields.email) : null;
  if (fields.email.trim() && !email) return { ok: false, error: "That email doesn't look right. Fix it, or leave it blank." };
  if (!(await allowAttempt(`checkin-new:${staff.employeeId}`, 5, 60))) return { ok: false, error: TOO_MANY_TRIES };

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

export type KioskCreate =
  | { ok: true; status: "known"; request: CheckinRequest }
  | { ok: true; status: "created"; request: CheckinRequest; firstName: string; claimUrl: string | null }
  | { ok: false; error: string };

// A number we don't know, at the door: the account is made right away from
// a first and last name, so the next person doesn't wait on the bartender.
// Staff still confirm the visit on the register (that's what pays points),
// and they see "New regular" with the name. The customer finishes the rest
// (email, password, photo) on their own phone from the QR code, when a
// claim link is available. Email marketing stays off.
export async function createKioskMember(fields: { phone: string; firstName: string; lastName: string }): Promise<KioskCreate> {
  const staff = await assertStaff();
  const digits = phoneDigits(fields.phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  const firstName = cleanFirstName(fields.firstName);
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const lastName = cleanFirstName(fields.lastName);
  if (!lastName) return { ok: false, error: "Type your last name (letters only)." };
  if (!(await allowAttempt(`checkin-create:${staff.employeeId}`, 8, 60))) return { ok: false, error: TOO_MANY_TRIES };

  // Signed up (here or on the other screen) since the lookup: an ordinary
  // check-in instead of a second account.
  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length > 0) return { ok: true, status: "known", request: sealCheckin({ kind: "known", phone: digits }) };

  const { data, error } = await createAdminClient()
    .from("members")
    .insert({ name: `${firstName} ${lastName}`, phone: formatPhone(digits), email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "We couldn't set that up just now. Ask your bartender to add you." };

  // The "finish on your phone" QR code: a 30-minute claim link for the
  // account just made (lib/member-claim.ts). Null if it can't be made (the
  // member_claims migration not applied yet): the screen then just says
  // welcome.
  const claimUrl = await issueClaimLink(data.id, "kiosk");
  return { ok: true, status: "created", request: sealCheckin({ kind: "known", phone: digits, fresh: true }), firstName, claimUrl };
}
