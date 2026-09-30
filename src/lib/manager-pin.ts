import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasManagerAccess } from "@/lib/auth";
import { hashPin, randomPin, verifyPin } from "@/lib/pin";
import { DEFAULT_PIN, TEMP_PIN_DAYS, isPinShaped, tempPinExpired, type Approval } from "@/lib/pin-rules";
import { businessDay } from "@/lib/ops/time";

// Manager approval: refunds (reports, member page, register), cancelling a
// tab, cancelling a booth booking. One place for all of it, so each check
// says whose PIN it was, logs the try, and counts toward the guess limit.
//
// Guess limit: 5 wrong manager PINs within 10 minutes locks approvals for
// 10 minutes. Counted across the whole venue, not per register, since a
// serverless function's memory isn't shared and it's one building. The
// tries live in pin_attempts (migration 20260929100000_manager_pins.sql).

const WINDOW_MS = 10 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_WRONG = 5;

// Wrong "current PIN" tries on the My PIN screen, counted per person and
// kept out of the venue-wide approval count.
const MY_PIN = "my-pin";

const SET_OWN = "Set your own PIN under My PIN in the back office.";

// ---------- the cutover ----------
// MANAGER_PIN_CUTOVER=YYYY-MM-DD in the environment. From 4 a.m. that day
// (when the business day starts), 9999 stops approving anything, and so
// does a temporary PIN from the owner more than TEMP_PIN_DAYS old: the
// person has to set their own under My PIN first. Unset, neither is
// enforced. Set it once every manager has their own PIN (the Staff page
// lists who hasn't).
export function pinCutover(now = new Date()): { date: string; reached: boolean } | null {
  const date = process.env.MANAGER_PIN_CUTOVER?.trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.warn(`MANAGER_PIN_CUTOVER should be a date like 2026-10-15, not "${date}", so it isn't enforced.`);
    return null;
  }
  return { date, reached: businessDay(now).date >= date };
}

type Scope = { approvals: true } | { myPin: string };

interface Tries {
  lockedUntil: number | null;
  wrongInWindow: number;
}

// Null when the log can't be read: the caller refuses rather than letting
// a guess through uncounted.
async function recentTries(scope: Scope): Promise<Tries | null> {
  const since = new Date(Date.now() - WINDOW_MS - LOCK_MS).toISOString();
  let q = createAdminClient().from("pin_attempts").select("at").eq("ok", false).gte("at", since).order("at");
  q = "myPin" in scope ? q.eq("context", MY_PIN).eq("requested_by", scope.myPin) : q.neq("context", MY_PIN);
  const { data, error } = await q;
  if (error) {
    console.error("pin_attempts not read:", error.message);
    return null;
  }

  // Locked for 10 minutes from any wrong try that made 5 inside 10 minutes.
  // Tries refused during a lock aren't logged, so they can't stretch it.
  const wrong = (data ?? []).map((r) => Date.parse(r.at as string));
  let lockedUntil: number | null = null;
  for (let i = MAX_WRONG - 1; i < wrong.length; i++) {
    if (wrong[i] - wrong[i - MAX_WRONG + 1] <= WINDOW_MS) lockedUntil = Math.max(lockedUntil ?? 0, wrong[i] + LOCK_MS);
  }
  const now = Date.now();
  return {
    lockedUntil: lockedUntil && lockedUntil > now ? lockedUntil : null,
    wrongInWindow: wrong.filter((t) => t > now - WINDOW_MS).length,
  };
}

async function logTry(row: { ok: boolean; context: string; target?: string | null; approver_id?: string | null; requested_by: string }) {
  const { error } = await createAdminClient().from("pin_attempts").insert(row);
  if (error) console.error("pin_attempts not logged:", error.message);
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// "Incorrect manager PIN." plus how many tries are left, or that this one
// just set off the lock.
function wrongMessage(what: string, before: Tries, locked: string): string {
  const left = MAX_WRONG - (before.wrongInWindow + 1);
  if (left <= 0) return `Incorrect ${what}. That's ${MAX_WRONG} wrong tries in 10 minutes, so ${locked} until ${clock(Date.now() + LOCK_MS)}.`;
  return `Incorrect ${what}. ${left} more ${left === 1 ? "try" : "tries"} before ${locked} for 10 minutes.`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export type ManagerPinCheck = ({ ok: true; approverId: string | null } & Approval) | { ok: false; error: string };

// Does this PIN belong to an active manager, admin or owner (the same
// roles as hasManagerAccess)? If so, which one. requestedBy is whoever is
// signed in (on the register, its shared login); target is the order,
// booking or booth reservation it's for, for the log.
export async function checkManagerPin(pin: string, context: string, requestedBy: string, target?: string): Promise<ManagerPinCheck> {
  if (!isPinShaped(pin)) return { ok: false, error: "Enter a manager PIN (4 to 6 digits)." };

  const before = await recentTries({ approvals: true });
  if (!before) return { ok: false, error: "Couldn't check the PIN. Try again." };
  if (before.lockedUntil) {
    return { ok: false, error: `Too many wrong PINs. Manager approvals are locked until ${clock(before.lockedUntil)}, then a manager can try again.` };
  }

  // After the cutover 9999 is a wrong PIN everyone knows, so it counts
  // toward the limit like any other wrong one.
  const cutover = pinCutover()?.reached ?? false;
  if (cutover && pin === DEFAULT_PIN) {
    await logTry({ ok: false, context, target, requested_by: requestedBy });
    return { ok: false, error: `9999 doesn't approve anything any more. ${SET_OWN}` };
  }

  const { data, error } = await createAdminClient().from("employees").select("id, name, role, pin_hash, pin_must_change, pin_set_at").eq("active", true);
  if (error) return { ok: false, error: "Couldn't check the PIN. Try again." };
  const matches = (data ?? []).filter((e) => hasManagerAccess(e.role) && verifyPin(pin, e.pin_hash));

  if (matches.length === 0) {
    await logTry({ ok: false, context, target, requested_by: requestedBy });
    return { ok: false, error: wrongMessage("manager PIN", before, "manager approvals are locked") };
  }

  // A temporary PIN the owner handed out and nobody changed: after the
  // cutover it only works for TEMP_PIN_DAYS. Logged against whose it is.
  const current = cutover ? matches.filter((e) => !tempPinExpired(e)) : matches;
  if (current.length === 0) {
    await logTry({ ok: false, context, target, approver_id: matches.length === 1 ? matches[0].id : null, requested_by: requestedBy });
    return { ok: false, error: `That temporary PIN is more than ${TEMP_PIN_DAYS} days old, so it doesn't approve anything any more. ${SET_OWN}` };
  }

  // Two or more managers with the same PIN (everyone still on 9999, most
  // likely): it's approved, but there's no telling who.
  const approver = current.length === 1 ? current[0] : null;
  await logTry({ ok: true, context, target, approver_id: approver?.id ?? null, requested_by: requestedBy });
  return { ok: true, approverId: approver?.id ?? null, approvedBy: approver ? firstName(approver.name) : null, defaultPin: pin === DEFAULT_PIN };
}

// The "current PIN" on the My PIN screen. Same limit, but per person: 5
// wrong in 10 minutes and they wait 10 minutes.
export async function checkOwnPin(employeeId: string, pin: string, stored: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const before = await recentTries({ myPin: employeeId });
  if (!before) return { ok: false, error: "Couldn't check your PIN. Try again." };
  if (before.lockedUntil) return { ok: false, error: `Too many wrong tries. Try again after ${clock(before.lockedUntil)}.` };
  if (isPinShaped(pin) && verifyPin(pin, stored)) return { ok: true };
  await logTry({ ok: false, context: MY_PIN, requested_by: employeeId });
  return { ok: false, error: wrongMessage("current PIN", before, "you're locked out") };
}

// ---------- one PIN, one person ----------
// Two managers on the same PIN approve with no name on it, so a PIN that's
// picked or handed out can't be one another manager already has. PINs are
// hashed, so each candidate is checked against every manager's hash.

// Hashes of the active managers, admins and owners other than `except`.
async function otherManagerHashes(except: string | null): Promise<string[] | null> {
  const { data, error } = await createAdminClient().from("employees").select("id, role, pin_hash").eq("active", true);
  if (error) return null;
  return (data ?? []).filter((e) => e.id !== except && hasManagerAccess(e.role)).map((e) => e.pin_hash as string);
}

// For My PIN, when a manager picks a new PIN. A clash counts toward their
// own guess limit: otherwise trying PIN after PIN here would be a way to
// find out another manager's.
export async function checkPinFree(employeeId: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const before = await recentTries({ myPin: employeeId });
  const others = await otherManagerHashes(employeeId);
  if (!before || !others) return { ok: false, error: "Couldn't save your PIN. Try again." };
  if (before.lockedUntil) return { ok: false, error: `Too many tries. Try again after ${clock(before.lockedUntil)}.` };
  if (!others.some((h) => verifyPin(pin, h))) return { ok: true };
  await logTry({ ok: false, context: MY_PIN, requested_by: employeeId });
  return { ok: false, error: "Another manager already has that PIN. Pick a different one, so each approval shows who gave it." };
}

// A temporary PIN for a new staff account or an owner reset, with the
// columns to save alongside it: pin_must_change so the back office asks
// them to pick their own, pin_set_at so it runs out after the cutover.
// employeeId is whose it will be (null for an account not made yet).
export async function newTempPin(employeeId: string | null): Promise<{ pin: string; columns: { pin_hash: string; pin_must_change: true; pin_set_at: string } } | null> {
  const others = await otherManagerHashes(employeeId);
  if (!others) return null;
  for (let i = 0; i < 10; i++) {
    const pin = randomPin();
    if (!others.some((h) => verifyPin(pin, h))) return { pin, columns: { pin_hash: hashPin(pin), pin_must_change: true, pin_set_at: new Date().toISOString() } };
  }
  return null;
}

// Which manager approved a refund or booth cancel, on the row itself. Best
// effort: the money has already gone back by the time this runs, so a
// failed write mustn't turn it into an error. The pin_attempts log has it
// either way.
export async function recordApprover(table: "orders" | "bookings" | "booth_reservations", id: string, approverId: string | null) {
  if (!approverId) return;
  const { error } = await createAdminClient().from(table).update({ refund_approved_by: approverId }).eq("id", id);
  if (error) console.warn(`${table}.refund_approved_by not saved:`, error.message);
}
