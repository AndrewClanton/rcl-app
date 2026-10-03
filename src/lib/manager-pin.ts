import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasManagerAccess } from "@/lib/auth";
import { verifyPin } from "@/lib/pin";
import { DEFAULT_PIN, isPinShaped, type Approval } from "@/lib/pin-rules";

// Manager approval: refunds (reports, member page, register), cancelling a
// tab, cancelling a booth booking. One place for all of it, so each check
// says whose PIN it was, logs the try, and counts toward the guess limit.
//
// Guess limit: 5 wrong manager PINs within 10 minutes locks approvals for
// 10 minutes. Counted across the whole venue, not per register, since a
// serverless function's memory isn't shared and it's one building. The
// tries live in pin_attempts (migration 20260929100000_manager_pins.sql);
// until that's applied, the limit and log are skipped rather than blocking
// refunds.

const WINDOW_MS = 10 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_WRONG = 5;

// Wrong "current PIN" tries on the My PIN screen, counted per person and
// kept out of the venue-wide approval count.
const MY_PIN = "my-pin";

type Scope = { approvals: true } | { myPin: string };

interface Tries {
  tracked: boolean; // false until pin_attempts exists
  lockedUntil: number | null;
  wrongInWindow: number;
}

async function recentTries(scope: Scope): Promise<Tries> {
  const since = new Date(Date.now() - WINDOW_MS - LOCK_MS).toISOString();
  let q = createAdminClient().from("pin_attempts").select("at").eq("ok", false).gte("at", since).order("at");
  q = "myPin" in scope ? q.eq("context", MY_PIN).eq("requested_by", scope.myPin) : q.neq("context", MY_PIN);
  const { data, error } = await q;
  if (error) return { tracked: false, lockedUntil: null, wrongInWindow: 0 };

  // Locked for 10 minutes from any wrong try that made 5 inside 10 minutes.
  // Tries refused during a lock aren't logged, so they can't stretch it.
  const wrong = (data ?? []).map((r) => Date.parse(r.at as string));
  let lockedUntil: number | null = null;
  for (let i = MAX_WRONG - 1; i < wrong.length; i++) {
    if (wrong[i] - wrong[i - MAX_WRONG + 1] <= WINDOW_MS) lockedUntil = Math.max(lockedUntil ?? 0, wrong[i] + LOCK_MS);
  }
  const now = Date.now();
  return {
    tracked: true,
    lockedUntil: lockedUntil && lockedUntil > now ? lockedUntil : null,
    wrongInWindow: wrong.filter((t) => t > now - WINDOW_MS).length,
  };
}

async function logTry(row: { ok: boolean; context: string; target?: string | null; approver_id?: string | null; requested_by: string }) {
  const { error } = await createAdminClient().from("pin_attempts").insert(row);
  if (error) console.warn("pin_attempts not logged (migration 20260929100000_manager_pins.sql applied?):", error.message);
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// "Incorrect manager PIN." plus how many tries are left, or that this one
// just set off the lock.
function wrongMessage(what: string, before: Tries, locked: string): string {
  if (!before.tracked) return `Incorrect ${what}.`;
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
  if (before.lockedUntil) {
    return { ok: false, error: `Too many wrong PINs. Manager approvals are locked until ${clock(before.lockedUntil)}, then a manager can try again.` };
  }

  const { data, error } = await createAdminClient().from("employees").select("id, name, role, pin_hash").eq("active", true);
  if (error) return { ok: false, error: "Couldn't check the PIN. Try again." };
  const matches = (data ?? []).filter((e) => hasManagerAccess(e.role) && verifyPin(pin, e.pin_hash));

  if (matches.length === 0) {
    await logTry({ ok: false, context, target, requested_by: requestedBy });
    return { ok: false, error: wrongMessage("manager PIN", before, "manager approvals are locked") };
  }

  // Two or more managers with the same PIN (everyone still on 9999, most
  // likely): it's approved, but there's no telling who.
  const approver = matches.length === 1 ? matches[0] : null;
  await logTry({ ok: true, context, target, approver_id: approver?.id ?? null, requested_by: requestedBy });
  return { ok: true, approverId: approver?.id ?? null, approvedBy: approver ? firstName(approver.name) : null, defaultPin: pin === DEFAULT_PIN };
}

// One named person's own PIN, for something only they can approve: the
// owner rate on the register (lib/owner-rate-server.ts), where the approver
// has to be that same owner. Checked against their PIN alone, with the same
// venue-wide guess limit and log as a manager approval, so guessing an
// owner's PIN locks approvals like any wrong manager PIN. A PIN somebody
// else knows doesn't prove it's them: 9999, or a temporary PIN an owner set
// on the Staff page, is turned down until they pick their own.
export async function checkPersonPin(
  employeeId: string,
  pin: string,
  context: string,
  requestedBy: string,
  target?: string,
): Promise<{ ok: true; approverId: string; approvedBy: string } | { ok: false; error: string }> {
  if (!isPinShaped(pin)) return { ok: false, error: "Enter your PIN (4 to 6 digits)." };

  const before = await recentTries({ approvals: true });
  if (before.lockedUntil) {
    return { ok: false, error: `Too many wrong PINs. Approvals are locked until ${clock(before.lockedUntil)}, then try again.` };
  }

  // "*": pin_must_change comes with the manager PINs migration.
  const { data, error } = await createAdminClient().from("employees").select("*").eq("id", employeeId).maybeSingle();
  if (error) return { ok: false, error: "Couldn't check the PIN. Try again." };
  const person = data as { id: string; name: string; active: boolean; pin_hash: string; pin_must_change?: boolean | null } | null;
  if (!person || !person.active) return { ok: false, error: "That login isn't active." };
  // A login with no PIN set (a TV screen, say) can't approve anything.
  if (typeof person.pin_hash !== "string" || !person.pin_hash.startsWith("scrypt$")) {
    return { ok: false, error: `${firstName(person.name)} has no PIN set. Set one under My PIN in the back office first.` };
  }

  if (!verifyPin(pin, person.pin_hash)) {
    await logTry({ ok: false, context, target, requested_by: requestedBy });
    return { ok: false, error: wrongMessage("PIN", before, "approvals are locked") };
  }
  const name = firstName(person.name);
  if (pin === DEFAULT_PIN) {
    return { ok: false, error: `${name}'s PIN is still 9999, which everyone knows. ${name}: pick your own under My PIN in the back office first.` };
  }
  if (person.pin_must_change) {
    return { ok: false, error: `${name} is still on the temporary PIN an owner set. ${name}: pick your own under My PIN in the back office first.` };
  }
  await logTry({ ok: true, context, target, approver_id: person.id, requested_by: requestedBy });
  return { ok: true, approverId: person.id, approvedBy: name };
}

// An owner's PIN, from any owner but `notId`: taking an order off an owner's
// tab (refundOrder in app/admin/reports/actions.ts) is for one of the other
// owners, so nobody takes their own drinks off their own tab. Same guess
// limit and log as a manager approval; 9999, a temporary PIN, or a PIN two
// owners share (no telling whose) is turned down.
export async function checkOtherOwnerPin(
  pin: string,
  notId: string | null,
  context: string,
  requestedBy: string,
  target?: string,
): Promise<{ ok: true; approverId: string; approvedBy: string } | { ok: false; error: string }> {
  if (!isPinShaped(pin)) return { ok: false, error: "Enter an owner's PIN (4 to 6 digits)." };

  const before = await recentTries({ approvals: true });
  if (before.lockedUntil) {
    return { ok: false, error: `Too many wrong PINs. Approvals are locked until ${clock(before.lockedUntil)}, then try again.` };
  }

  // "*": pin_must_change comes with the manager PINs migration.
  const { data, error } = await createAdminClient().from("employees").select("*").eq("active", true).eq("role", "owner");
  if (error) return { ok: false, error: "Couldn't check the PIN. Try again." };
  const owners = (data ?? []) as { id: string; name: string; pin_hash: string | null; pin_must_change?: boolean | null }[];
  const fits = (o: (typeof owners)[number]) => typeof o.pin_hash === "string" && o.pin_hash.startsWith("scrypt$") && verifyPin(pin, o.pin_hash);
  const others = owners.filter((o) => o.id !== notId && fits(o));
  if (others.length === 0) {
    await logTry({ ok: false, context, target, requested_by: requestedBy });
    const own = owners.find((o) => o.id === notId && fits(o));
    if (own) return { ok: false, error: `That's ${firstName(own.name)}'s own PIN. Another owner takes an order off ${firstName(own.name)}'s tab.` };
    return { ok: false, error: wrongMessage("owner PIN", before, "approvals are locked") };
  }
  if (others.length > 1 || pin === DEFAULT_PIN) {
    return { ok: false, error: "That PIN isn't one owner's alone (still 9999, or shared), so it can't approve this. Set your own under My PIN." };
  }
  const approver = others[0];
  if (approver.pin_must_change) {
    return { ok: false, error: `${firstName(approver.name)} is still on the temporary PIN an owner set. Pick your own under My PIN first.` };
  }
  await logTry({ ok: true, context, target, approver_id: approver.id, requested_by: requestedBy });
  return { ok: true, approverId: approver.id, approvedBy: firstName(approver.name) };
}

// The "current PIN" on the My PIN screen. Same limit, but per person: 5
// wrong in 10 minutes and they wait 10 minutes.
export async function checkOwnPin(employeeId: string, pin: string, stored: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const before = await recentTries({ myPin: employeeId });
  if (before.lockedUntil) return { ok: false, error: `Too many wrong tries. Try again after ${clock(before.lockedUntil)}.` };
  if (isPinShaped(pin) && verifyPin(pin, stored)) return { ok: true };
  await logTry({ ok: false, context: MY_PIN, requested_by: employeeId });
  return { ok: false, error: wrongMessage("current PIN", before, "you're locked out") };
}

// Which manager approved a refund or booth cancel, on the row itself. Best
// effort: the money has already gone back by the time this runs, so a
// missing column (migration not applied yet) must not turn it into an
// error. The pin_attempts log has it either way.
export async function recordApprover(table: "orders" | "bookings" | "booth_reservations", id: string, approverId: string | null) {
  if (!approverId) return;
  const { error } = await createAdminClient().from(table).update({ refund_approved_by: approverId }).eq("id", id);
  if (error) console.warn(`${table}.refund_approved_by not saved (migration 20260929100000_manager_pins.sql applied?):`, error.message);
}
