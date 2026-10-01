import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLAIM_PATH } from "@/lib/claim-link";

// The signed values behind "claim your account" links (lib/member-claim.ts
// does the rest). Kept in their own file so lib/member-link.ts can check
// for a claim in progress without the two files importing each other.
//
// A claim token is 43 bytes, sent as 58 characters of base64url so the QR
// code on a receipt stays small:
//   version (1) | kind (1) | member id (16) | expires, unix seconds (4) |
//   nonce (9) | signature (12)
// The signature is an HMAC under a key only the server has (derived from
// the service key, like the register's channel name), so a token can't be
// made up or edited. The nonce is also recorded in member_claims, which is
// what makes each link work only once.

// "email": the "Set my password" link in the invite email (lib/email).
export type ClaimKind = "kiosk" | "receipt" | "email";

// Kiosk links are on the tablet for a moment and scanned on the spot;
// receipt links go home in a pocket; the invite email's last 30 days.
export const CLAIM_LIFETIME_S: Record<ClaimKind, number> = { kiosk: 30 * 60, receipt: 14 * 86_400, email: 30 * 86_400 };

// Wrong guesses at the last four of the phone before a link stops working
// for good (on top of the per-minute limits in member-claim.ts).
export const MAX_WRONG_DIGITS = 10;

const VERSION = 1;
// New kinds go on the end: a token stores its kind by position.
const KINDS: ClaimKind[] = ["kiosk", "receipt", "email"];
const BODY_BYTES = 31;
const SIG_BYTES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(purpose: string): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No secret means anyone could sign a token: make none at all.
  if (!secret) return null;
  return createHmac("sha256", secret).update(`member-claim-v1:${purpose}`).digest();
}

function sign(purpose: string, data: Buffer | string, bytes: number): Buffer | null {
  const k = key(purpose);
  return k ? createHmac("sha256", k).update(data).digest().subarray(0, bytes) : null;
}

export interface ClaimToken {
  memberId: string;
  kind: ClaimKind;
  exp: number; // ms
  nonce: string; // base64url, as stored in member_claims
  expired: boolean;
}

// `fixed`: a nonce and expiry chosen by the caller instead of random and
// now-based (the invite email's links, so a retried send renders the very
// same email).
export function sealClaimToken(
  memberId: string,
  kind: ClaimKind,
  now = Date.now(),
  fixed?: { nonce: Buffer; expS: number },
): { token: string; nonce: string; exp: number } | null {
  if (!UUID.test(memberId) || !KINDS.includes(kind)) return null;
  if (fixed && fixed.nonce.length !== 9) return null;
  const expS = fixed ? fixed.expS : Math.floor(now / 1000) + CLAIM_LIFETIME_S[kind];
  const nonce = fixed ? fixed.nonce : randomBytes(9);
  const body = Buffer.alloc(BODY_BYTES);
  body[0] = VERSION;
  body[1] = KINDS.indexOf(kind);
  Buffer.from(memberId.replace(/-/g, ""), "hex").copy(body, 2);
  body.writeUInt32BE(expS, 18);
  nonce.copy(body, 22);
  const sig = sign("token", body, SIG_BYTES);
  if (!sig) return null;
  return { token: Buffer.concat([body, sig]).toString("base64url"), nonce: nonce.toString("base64url"), exp: expS * 1000 };
}

// What a token says, or null if it isn't one of ours or was changed. An
// out-of-date token still opens (with expired: true), so the page can say
// "this link has run out" rather than "this link is broken".
export function openClaimToken(token: string | null | undefined, now = Date.now()): ClaimToken | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{58}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== BODY_BYTES + SIG_BYTES || raw[0] !== VERSION || raw[1] >= KINDS.length) return null;
  const body = raw.subarray(0, BODY_BYTES);
  const expected = sign("token", body, SIG_BYTES);
  if (!expected || !timingSafeEqual(expected, raw.subarray(BODY_BYTES))) return null;
  const hex = body.subarray(2, 18).toString("hex");
  const exp = body.readUInt32BE(18) * 1000;
  return {
    memberId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    kind: KINDS[raw[1]],
    exp,
    nonce: body.subarray(22, 31).toString("base64url"),
    expired: exp <= now,
  };
}

// The invite email's claim link for one send: the nonce comes from the
// send's id, so rendering that email again (a retried batch) gives the same
// link, and they share one member_claims row.
export function emailClaimNonce(sendId: string): Buffer | null {
  return sign("email-nonce", sendId, 9);
}

// ---------- "the phone digits matched" ----------
// Once someone types the right last four, this browser gets a short-lived
// signed note saying so for that one link (kept in an httpOnly cookie by
// the claim page). It lets them go off to Google to sign in and come back
// without typing the digits again, and it's what the final link step
// checks. Useless for any other link.

export const DIGITS_PROOF_COOKIE = "rcl_claim_ok";
const PROOF_LIFETIME_S = 30 * 60;

export function sealDigitsProof(nonce: string, claimExp: number, now = Date.now()): { value: string; maxAge: number } | null {
  const expS = Math.min(Math.floor(now / 1000) + PROOF_LIFETIME_S, Math.floor(claimExp / 1000));
  const maxAge = expS - Math.floor(now / 1000);
  if (maxAge <= 0) return null;
  const sig = sign("digits", `${nonce}.${expS}`, 16);
  return sig ? { value: `${nonce}.${expS}.${sig.toString("base64url")}`, maxAge } : null;
}

export function digitsProofOk(value: string | null | undefined, nonce: string, now = Date.now()): boolean {
  const parts = typeof value === "string" ? value.split(".") : [];
  if (parts.length !== 3 || parts[0] !== nonce || !/^\d{1,12}$/.test(parts[1])) return false;
  if (Number(parts[1]) * 1000 <= now) return false;
  const expected = sign("digits", `${parts[0]}.${parts[1]}`, 16);
  const given = Buffer.from(parts[2], "base64url");
  return !!expected && given.length === expected.length && timingSafeEqual(expected, given);
}

// ---------- a claim in progress on a new login ----------
// The claim page's "Create account" puts the link's token on the new login
// (user_metadata.rcl_claim). When Supabase's "Confirm email" is on, the
// person only gets a session after clicking the emailed link, and that
// confirm step runs linkMemberForUser, which would otherwise make them a
// second, empty account before the claim page could link the real one.
// This says whether that claim can still be finished (and where), so
// linkMemberForUser can leave the linking to the claim page. Once the link
// is used, runs out or locks, it no longer counts and sign-in works as usual.
export async function pendingClaimFor(user: User): Promise<string | null> {
  const t = user.user_metadata?.rcl_claim;
  const c = typeof t === "string" ? openClaimToken(t) : null;
  if (!c || c.expired) return null;
  const admin = createAdminClient();
  const { data: claim } = await admin.from("member_claims").select("member_id, used_at, failed_tries").eq("nonce", c.nonce).maybeSingle();
  if (!claim || claim.member_id !== c.memberId || claim.used_at || claim.failed_tries >= MAX_WRONG_DIGITS) return null;
  const { data: m } = await admin.from("members").select("auth_user_id, erased_at").eq("id", c.memberId).maybeSingle();
  if (!m || m.auth_user_id || m.erased_at) return null;
  return `${CLAIM_PATH}?t=${t}`;
}
