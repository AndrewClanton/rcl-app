import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MemberPriceTier } from "@/lib/types";
import type { BillingInterval } from "@/lib/membership-rates";

// The signed value behind a "finish your Insiders+ on your phone" link
// (lib/plus-finish-link.ts). It names the member and the plan staff picked
// at the register (a senior or student rate only after an ID check there),
// so the person scanning it can't change either. 36 bytes, sent as 48
// characters of base64url so the QR code stays small:
//   version (1) | kind (1) | member id (16) | rate (1) | interval (1) |
//   expires, unix seconds (4) | signature (12)
// Signed with a key only the server has (derived from the service key, like
// the claim links). Not one-time: opening it again only opens Stripe's page
// again, and someone already paying is sent to their billing page instead.

export type FinishKind = "tablet" | "email";

// On the customer screen it's scanned on the spot; an emailed one waits in
// their inbox for a week.
export const FINISH_LIFETIME_S: Record<FinishKind, number> = { tablet: 30 * 60, email: 7 * 86_400 };

const VERSION = 1;
const KINDS: FinishKind[] = ["tablet", "email"];
const RATES: MemberPriceTier[] = ["adult", "senior", "student"];
const INTERVALS: BillingInterval[] = ["month", "year"];
const BODY_BYTES = 24;
const SIG_BYTES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(data: Buffer): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No secret means anyone could sign one: make none at all.
  if (!secret) return null;
  const key = createHmac("sha256", secret).update("plus-finish-v1").digest();
  return createHmac("sha256", key).update(data).digest().subarray(0, SIG_BYTES);
}

export interface FinishToken {
  memberId: string;
  kind: FinishKind;
  tier: MemberPriceTier;
  interval: BillingInterval;
  exp: number; // ms
  expired: boolean;
}

export function sealFinishToken(p: { memberId: string; kind: FinishKind; tier: MemberPriceTier; interval: BillingInterval }, now = Date.now()): string | null {
  if (!UUID.test(p.memberId) || !KINDS.includes(p.kind) || !RATES.includes(p.tier) || !INTERVALS.includes(p.interval)) return null;
  const body = Buffer.alloc(BODY_BYTES);
  body[0] = VERSION;
  body[1] = KINDS.indexOf(p.kind);
  Buffer.from(p.memberId.replace(/-/g, ""), "hex").copy(body, 2);
  body[18] = RATES.indexOf(p.tier);
  body[19] = INTERVALS.indexOf(p.interval);
  body.writeUInt32BE(Math.floor(now / 1000) + FINISH_LIFETIME_S[p.kind], 20);
  const sig = sign(body);
  return sig ? Buffer.concat([body, sig]).toString("base64url") : null;
}

// What a token says, or null if it isn't one of ours or was changed. An
// out-of-date one still opens (expired: true), so the page can say so.
export function openFinishToken(token: string | null | undefined, now = Date.now()): FinishToken | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{48}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== BODY_BYTES + SIG_BYTES || raw[0] !== VERSION || raw[1] >= KINDS.length || raw[18] >= RATES.length || raw[19] >= INTERVALS.length) return null;
  const body = raw.subarray(0, BODY_BYTES);
  const expected = sign(body);
  if (!expected || !timingSafeEqual(expected, raw.subarray(BODY_BYTES))) return null;
  const hex = body.subarray(2, 18).toString("hex");
  const exp = body.readUInt32BE(20) * 1000;
  return {
    memberId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    kind: KINDS[raw[1]],
    tier: RATES[raw[18]],
    interval: INTERVALS[raw[19]],
    exp,
    expired: exp <= now,
  };
}
