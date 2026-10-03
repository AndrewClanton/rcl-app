import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { allowAttempt } from "@/lib/rate-limit";

// Limits for the website's public forms (tickets, booths, event requests,
// joining): anyone can post to a Server Action directly, without the page,
// so each one counts tries per connection and says no to a flood.
//
// Two layers:
//   1. A per-connection limit on every form (allowFromConnection).
//   2. On the free paths that skip Stripe (a free screening or an
//      Insiders+ seat, an Insiders+ booth), a light bot check: a hidden
//      field people never fill in, and a signed "page opened at" stamp so a
//      form sent back in under a few seconds is refused. No third-party
//      CAPTCHA: nothing extra loads, nothing is sent anywhere.

export const TOO_MANY_FROM_CONNECTION = "Too many tries from this connection. Wait a minute and try again.";

// The visitor's IP as Vercel reports it (it sets both headers itself, so a
// visitor can't choose their own), hashed: the limit only needs to tell
// connections apart, and rate_limit_hits never has to hold a raw IP. Local
// `next dev` has neither header, so everyone there shares one bucket.
export async function connectionKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`rcl-public-form:${ip}`).digest("base64url").slice(0, 22);
}

// A short burst window (so "wait a minute" is true) plus an hourly cap, so
// a patient script can't keep going at the burst rate all day. Generous
// enough for a family on one phone line, a mobile carrier that puts many
// customers behind one address, or a group booking on the Royale's Wi-Fi.
export interface FormLimit {
  perMinute: number;
  perHour: number;
}

export const FORM_LIMITS = {
  tickets: { perMinute: 15, perHour: 80 },
  booths: { perMinute: 10, perHour: 40 },
  eventInquiry: { perMinute: 4, perHour: 12 },
  membership: { perMinute: 6, perHour: 30 },
} satisfies Record<string, FormLimit>;

export type GuardedForm = keyof typeof FORM_LIMITS;

export async function allowFromConnection(form: GuardedForm): Promise<boolean> {
  const limit = FORM_LIMITS[form];
  const key = `form:${form}:${await connectionKey()}`;
  // The minute count goes first: a try refused for the burst isn't also
  // counted against the hour.
  if (!(await allowAttempt(`${key}:m`, limit.perMinute, 60))) return false;
  return allowAttempt(`${key}:h`, limit.perHour, 3600);
}

// ---- Bot check for the free paths -------------------------------------------

// Faster than any person picks seats and presses the button; slow enough
// that a script has to wait on every single try.
const MIN_FILL_MS = 3_000;
// A page left open longer than this has to be refreshed first.
const MAX_FORM_AGE_MS = 12 * 3_600_000;

// (The hidden field itself is components/Honeypot.tsx.)

function signingKey(): Buffer {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("public-form-v1").digest();
}

function sign(form: GuardedForm, issuedAt: number): string {
  return createHmac("sha256", signingKey()).update(`${form}:${issuedAt}`).digest("base64url").slice(0, 32);
}

// Rendered into the page (server side) and sent back with the form. Signed,
// so a script can't just claim it opened the page ten seconds ago.
export function issueFormToken(form: GuardedForm): string {
  const issuedAt = Date.now();
  return `${issuedAt}.${sign(form, issuedAt)}`;
}

export interface HumanCheck {
  formToken?: string | null;
  honeypot?: string | null;
}

// Null when it looks like a person; otherwise a message to show. A real
// person who was just quick gets told to press again, and it goes through.
export function checkHuman(form: GuardedForm, input: HumanCheck): string | null {
  if (input.honeypot && input.honeypot.trim() !== "") return "Something went wrong. Refresh the page and try again.";
  const [at, sig] = (input.formToken ?? "").split(".");
  const issuedAt = Number(at);
  if (!Number.isFinite(issuedAt) || !sig) return "This page is out of date. Refresh it and try again.";
  const expected = Buffer.from(sign(form, issuedAt));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "This page is out of date. Refresh it and try again.";
  const age = Date.now() - issuedAt;
  if (age > MAX_FORM_AGE_MS) return "This page has been open a while. Refresh it and try again.";
  if (age < MIN_FILL_MS) return "That was quick! Give it a second, then press the button again.";
  return null;
}
