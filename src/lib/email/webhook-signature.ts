import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs its webhooks the Svix way
// (https://docs.svix.com/receiving/verifying-payloads/how-manual):
// HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>", keyed with the
// base64 part of the whsec_... signing secret, sent as one or more
// space-separated "v1,<base64>" entries in svix-signature.
const TOLERANCE_SECONDS = 5 * 60;

export function verifyResendSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  // An old (replayed) or far-future message is refused.
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
