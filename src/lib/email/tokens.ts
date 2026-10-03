import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE_URL } from "@/lib/site";

// The token in every email's unsubscribe and preferences links. It says
// which member (and which email, when there is one) without the address
// ever going in a URL, and it can't be made up or edited.
//
//   version (1) | member id (16) | send id (16, zeros if none) | HMAC (16)
//
// sent as 66 characters of base64url. The key is HMAC-SHA256 of a
// dedicated secret, EMAIL_TOKEN_SECRET (not the service key the claim links
// use: rotating that would break unsubscribe links, which must keep working
// long after the email went out). There is no expiry on purpose.
const VERSION = 1;
const BODY_BYTES = 33;
const SIG_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

export const UNSUBSCRIBE_PATH = "/api/email/unsubscribe";
export const PREFERENCES_PATH = "/email/preferences";

function key(): Buffer | null {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  // No secret (or a too-short one) means no tokens at all, so nothing can
  // be sent without a working unsubscribe link.
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret).update("rcl-email-link-v1").digest();
}

export function emailTokensReady(): boolean {
  return key() !== null;
}

const toBytes = (id: string) => Buffer.from(id.replace(/-/g, ""), "hex");
const fromBytes = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function sealEmailToken(p: { memberId: string; sendId: string | null }): string | null {
  const k = key();
  if (!k || !UUID.test(p.memberId) || (p.sendId !== null && !UUID.test(p.sendId))) return null;
  const body = Buffer.alloc(BODY_BYTES);
  body[0] = VERSION;
  toBytes(p.memberId).copy(body, 1);
  toBytes(p.sendId ?? ZERO_ID).copy(body, 17);
  const sig = createHmac("sha256", k).update(body).digest().subarray(0, SIG_BYTES);
  return Buffer.concat([body, sig]).toString("base64url");
}

export function openEmailToken(token: string | null | undefined): { memberId: string; sendId: string | null } | null {
  try {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{66}$/.test(token)) return null;
    const k = key();
    if (!k) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length !== BODY_BYTES + SIG_BYTES || raw[0] !== VERSION) return null;
    const body = raw.subarray(0, BODY_BYTES);
    const expected = createHmac("sha256", k).update(body).digest().subarray(0, SIG_BYTES);
    if (!timingSafeEqual(expected, raw.subarray(BODY_BYTES))) return null;
    const sendId = fromBytes(body.subarray(17, 33));
    return { memberId: fromBytes(body.subarray(1, 17)), sendId: sendId === ZERO_ID ? null : sendId };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(token: string): string {
  return `${SITE_URL}${UNSUBSCRIBE_PATH}?t=${token}`;
}

export function preferencesUrl(token: string, anchor: "" | "all" = ""): string {
  return `${SITE_URL}${PREFERENCES_PATH}?t=${token}${anchor ? `#${anchor}` : ""}`;
}

// RFC 8058 one-click unsubscribe: Gmail and Yahoo show their own
// "Unsubscribe" button and POST "List-Unsubscribe=One-Click" to this
// address. (Covered by the DKIM signature because Resend signs every
// header it's given; confirm with the seed test before going live.)
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
