"use server";

import { assertDisplayScreen } from "@/lib/auth";
import { cleanEmail, cleanFirstName, isFullPhone, phoneDigits, type CheckinRequest } from "@/lib/checkin";
import { memberIdsWithPhone, sealCheckin } from "@/lib/checkin-server";
import { allowAttempt, TOO_MANY_TRIES } from "@/lib/rate-limit";

// Check-in for points, from the customer screen. The screen page is gated by
// requireDisplayScreen() (a physical device, signed in with its display-only
// login or a staff one), and assertDisplayScreen() re-checks here so these
// can't be called by anyone else. Neither ever returns a
// member's details: a known number gets back a sealed request for the
// register, where staff see who it is and confirm; an unknown one just
// hears "new", so the screen can ask for a first name.

export type CheckinStart = { ok: true; status: "known"; request: CheckinRequest } | { ok: true; status: "new" } | { ok: false; error: string };

const NOT_A_NUMBER = "That doesn't look like a full phone number. Try again?";
const LOOKUP_FAILED = "We couldn't look that up just now. Ask a staff member for help.";

export async function startCheckin(phone: string): Promise<CheckinStart> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  // Anyone at the tablet can type numbers, so the lookup is capped per
  // signed-in screen, on top of the screen's own lockout.
  if (!(await allowAttempt(`checkin-lookup:${screen.employeeId}`, 10, 60))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: true, status: "new" };
  return { ok: true, status: "known", request: sealCheckin({ kind: "known", phone: digits }) };
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
