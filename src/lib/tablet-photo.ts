import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// The customer screen shows the member on the order their own photo (their
// card, MemberCards.tsx). The photo's stored address holds the member id,
// which works like a password at the door (lib/ticket-scan.ts), so it never
// goes over the broadcast channel: the register sends this sealed reference
// instead, and /display/customer/photo/<ref> (signed-in screens and staff
// only) opens it and sends the photo's bytes. Sealed with AES-GCM under a
// key only the server has, like a check-in's reference
// (lib/checkin-server.ts): anyone listening sees noise and can't forge one.
// It stops working after a long night.

const LIFETIME_MS = 12 * 60 * 60_000;

type Sealed = { m: string; exp: number };

function key(): Buffer {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("tablet-photo-v1").digest();
}

export function sealTabletPhoto(memberId: string): string {
  const body: Sealed = { m: memberId, exp: Date.now() + LIFETIME_MS };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const text = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), text]).toString("base64url");
}

// The member id, or null if the reference was tampered with, isn't one of
// ours, or has run out.
export function openTabletPhoto(ref: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]{40,200}$/.test(ref)) return null;
    const raw = Buffer.from(ref, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Sealed;
    if (typeof body.exp !== "number" || body.exp < Date.now() || typeof body.m !== "string") return null;
    return body.m;
  } catch {
    return null;
  }
}
