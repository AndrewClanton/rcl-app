import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { last10, type CheckinKind } from "@/lib/checkin";

// The opaque reference a check-in request carries over the broadcast
// channel. It's the check-in's details sealed with AES-GCM under a key only
// the server has (derived from the service key, like the channel's own
// name), so anyone listening sees noise, can't forge one, and can't change
// what's inside. It stops working after 15 minutes. The register opens it
// through a staff-only server action to show the confirm card.

export const CHECKIN_LIFETIME_MS = 15 * 60_000;

export type CheckinDetails =
  | { kind: "known"; phone: string }
  | { kind: "new"; phone: string; firstName: string; email: string | null; emailOptIn: boolean };

type Sealed = CheckinDetails & { id: string; exp: number };

function key(): Buffer {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("checkin-ref-v1").digest();
}

export function sealCheckin(details: CheckinDetails): { id: string; ref: string; kind: CheckinKind } {
  const id = randomBytes(9).toString("base64url");
  const body: Sealed = { ...details, id, exp: Date.now() + CHECKIN_LIFETIME_MS };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const text = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return { id, ref: Buffer.concat([iv, cipher.getAuthTag(), text]).toString("base64url"), kind: details.kind };
}

// The sealed details, or null if the reference was tampered with, isn't
// one of ours, or has run out.
export function openCheckin(ref: string): (CheckinDetails & { id: string }) | null {
  try {
    const raw = Buffer.from(ref, "base64url");
    if (raw.length < 29 || raw.length > 2048) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Sealed;
    if (typeof body.exp !== "number" || body.exp < Date.now() || typeof body.id !== "string") return null;
    return body;
  } catch {
    return null;
  }
}

// Members whose phone ends in these ten digits (phones are stored however
// they were typed; phone_digits is the digits-only copy, which may carry a
// leading country code, hence the suffix match). Oldest account first.
export async function memberIdsWithPhone(digits: string): Promise<{ ok: true; ids: string[] } | { ok: false }> {
  const { data, error } = await createAdminClient()
    .from("members")
    .select("id, phone")
    .is("erased_at", null)
    .like("phone_digits", `%${digits}`)
    .order("created_at")
    .limit(8);
  if (error) return { ok: false };
  return { ok: true, ids: (data ?? []).filter((m) => last10(m.phone) === digits).map((m) => m.id as string) };
}

// The member with this email, case-insensitively (matching the unique
// lower(email) index), if any.
export async function memberIdWithEmail(email: string): Promise<string | null> {
  const { data } = await createAdminClient().from("members").select("id").is("erased_at", null).ilike("email", exactEmail(email)).limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}
