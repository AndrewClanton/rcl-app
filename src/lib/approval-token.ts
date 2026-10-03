import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// A manager's PIN approval that lasts a few minutes, for screens where one
// approval covers several changes (the register's item settings: a new
// photo, then the price, then OUT). The PIN is checked once, by
// checkManagerPin(), and this token carries the approval to each change
// that follows. It's tied to what it approves (the scope), to the login
// that asked for it, and to when it runs out, and it's signed with a key
// only the server has (derived from the service key, like the claim links),
// so it can't be made up, edited or used from another sign-in.

export interface Approved {
  approverId: string | null;
}

type Body = { s: string; r: string; a: string | null; e: number };

function key(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No secret means anyone could sign one: make none at all.
  if (!secret) return null;
  return createHmac("sha256", secret).update("manager-approval-v1").digest();
}

function sign(k: Buffer, body: string): string {
  return createHmac("sha256", k).update(body).digest("base64url");
}

export function sealApproval(scope: string, requestedBy: string, approverId: string | null, ttlMs: number, now = Date.now()): string | null {
  const k = key();
  if (!k) return null;
  const body = Buffer.from(JSON.stringify({ s: scope, r: requestedBy, a: approverId, e: now + ttlMs } satisfies Body)).toString("base64url");
  return `${body}.${sign(k, body)}`;
}

// The approval, or null if it's not one of ours, for something else, for
// another sign-in, or out of time.
export function openApproval(token: unknown, scope: string, requestedBy: string, now = Date.now()): Approved | null {
  const read = readApproval(token, requestedBy);
  if (!read || read.scope !== scope || read.expires < now) return null;
  return { approverId: read.approverId };
}

// A signed approval for this sign-in, whatever it's for and whether or not
// it has run out: for a caller that has to know what an approval was for
// before it looks at the clock (the owner tab: a used approval finds the
// order it made, even after its 10 minutes). Null if it isn't one of ours
// or it's for another sign-in.
export function readApproval(token: unknown, requestedBy: string): (Approved & { scope: string; expires: number }) | null {
  const k = key();
  if (!k || typeof token !== "string" || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(k, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: Body;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Body;
  } catch {
    return null;
  }
  if (typeof parsed.s !== "string" || parsed.r !== requestedBy || typeof parsed.e !== "number") return null;
  return { scope: parsed.s, expires: parsed.e, approverId: typeof parsed.a === "string" ? parsed.a : null };
}
