import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { formatPhone, isFullPhone, last10, type CheckinKind } from "@/lib/checkin";
import { currentMemberId } from "@/lib/member-forward";

// The opaque reference a check-in request carries over the broadcast
// channel. It's the check-in's details sealed with AES-GCM under a key only
// the server has (derived from the service key, like the channel's own
// name), so anyone listening sees noise, can't forge one, and can't change
// what's inside. It stops working after 15 minutes. The register opens it
// through a staff-only server action to show the confirm card.

export const CHECKIN_LIFETIME_MS = 15 * 60_000;

export type CheckinDetails =
  // By phone: whoever has these ten digits (a shared family number can be
  // a few accounts; staff pick the face).
  // fresh: an account the tablet just made for a new customer.
  | { kind: "known"; phone: string; fresh?: boolean }
  // One account: found by the email typed at the tablet, or just made
  // there. phone: the ten digits it was found or made with, if any (for
  // "Phone ending" on the register's card). addPhone: ten digits they
  // typed and said yes to adding (their account has none), saved only
  // when staff confirm the check-in (pos/checkin-actions.ts confirmVisit).
  | { kind: "known"; memberId: string; phone?: string; addPhone?: string; fresh?: boolean }
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

// The number from the tablet's "Add this phone for one-tap check-in next
// time", once staff have confirmed the check-in (pos/checkin-actions.ts
// confirmVisit): only onto the account the request was sealed for (or the
// one it was merged into), only while it still has no usable phone, and
// only a number no other account has. Says what happened, for the
// register's note; null when there was nothing to add. Never throws.
export async function savePhoneFromCheckin(ref: string, memberId: string): Promise<string | null> {
  const c = openCheckin(ref);
  if (!c || c.kind !== "known" || !("memberId" in c) || !c.addPhone || !isFullPhone(c.addPhone)) return null;
  const phone = formatPhone(c.addPhone);
  const FAILED = `Couldn't add ${phone} to their account just now. Add it from their member page.`;
  try {
    if (((await currentMemberId(c.memberId)) ?? c.memberId) !== memberId) return null;
    const admin = createAdminClient();
    const { data: m, error } = await admin.from("members").select("phone").eq("id", memberId).is("erased_at", null).maybeSingle();
    if (error || !m) return FAILED;
    const had = last10(m.phone as string | null);
    if (isFullPhone(had)) return had === c.addPhone ? null : "They have a phone on file now, so the one from the tablet wasn't added.";
    const taken = await memberIdsWithPhone(c.addPhone);
    if (!taken.ok) return FAILED;
    if (taken.ids.some((id) => id !== memberId)) return `${phone} is on another account, so it wasn't added.`;
    // Only over what was there when read (nothing, or the old site's junk).
    const was = (m.phone as string | null) ?? null;
    const update = admin.from("members").update({ phone }).eq("id", memberId);
    const { data: saved, error: saveErr } = await (was === null ? update.is("phone", null) : update.eq("phone", was)).select("id");
    if (saveErr || !saved?.length) return FAILED;
    return `Added ${phone} to their account.`;
  } catch {
    return FAILED;
  }
}

export interface EmailMatch {
  id: string;
  name: string;
  phone: string | null;
}

// The same lookup for the door tablet, which needs to tell "no account"
// from "couldn't ask", and the name and phone (for "Welcome back, Sarah M."
// and whether to offer adding the number they typed). Nothing here leaves
// the server but what display/customer/actions.ts picks out.
export async function memberWithEmail(email: string): Promise<{ ok: true; member: EmailMatch | null } | { ok: false }> {
  const { data, error } = await createAdminClient().from("members").select("id, name, phone").is("erased_at", null).ilike("email", exactEmail(email)).limit(1);
  if (error) return { ok: false };
  const m = data?.[0];
  return { ok: true, member: m ? { id: m.id as string, name: (m.name as string | null) ?? "", phone: (m.phone as string | null) ?? null } : null };
}
