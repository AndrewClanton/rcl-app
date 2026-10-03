import "server-only";
import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

// The pictures with a first name in them (the door tablet's cheer, the
// profile screen, the VHS tape) are drawn when the email is opened, by
// /api/email/art. The name rides in the picture's address sealed, never in
// the clear: AES-256-GCM under a key made from EMAIL_TOKEN_SECRET, with the
// nonce made from the name itself, so one name always gives the same
// address (the same email on a retried send, and Gmail's image cache).
// Only a first name is ever in it.

function key(): Buffer | null {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret).update("rcl-email-art-v1").digest();
}

export function sealArtName(firstName: string | null | undefined): string | null {
  const k = key();
  const name = (firstName ?? "").trim().slice(0, 40);
  if (!k || !name) return null;
  const iv = createHmac("sha256", k).update(`iv:${name}`).digest().subarray(0, 12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(name, "utf8"), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]).toString("base64url");
}

export function openArtName(token: string | null | undefined): string | null {
  try {
    const k = key();
    if (!k || typeof token !== "string" || !/^[A-Za-z0-9_-]{38,140}$/.test(token)) return null;
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 1 + 16) return null;
    const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    const name = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
    return name.trim() ? name.slice(0, 40) : null;
  } catch {
    return null;
  }
}
