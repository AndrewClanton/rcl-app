import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// "Spend points" on the customer screen acts for the member on the order,
// but the screen never learns their member id (it works like a password at
// the door). The register sends this sealed reference with their card
// instead (TabletProfile.wallet), and the screen's reward actions
// (display/customer/reward-actions.ts) open it. Sealed with AES-GCM under a
// key only the server has, like the photo reference (lib/tablet-photo.ts):
// anyone listening on the channel sees noise and can't make one. It runs
// out after a few hours.

const LIFETIME_MS = 4 * 60 * 60_000;

type Sealed = { w: string; exp: number };

function key(): Buffer {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("tablet-wallet-v1").digest();
}

export function sealWallet(memberId: string): string {
  const body: Sealed = { w: memberId, exp: Date.now() + LIFETIME_MS };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const text = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), text]).toString("base64url");
}

export const WALLET_REF = /^[A-Za-z0-9_-]{40,200}$/;

// The member id, or null if it was tampered with, isn't ours, or ran out.
export function openWallet(ref: unknown): string | null {
  try {
    if (typeof ref !== "string" || !WALLET_REF.test(ref)) return null;
    const raw = Buffer.from(ref, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Sealed;
    if (typeof body.exp !== "number" || body.exp < Date.now() || typeof body.w !== "string") return null;
    return body.w;
  } catch {
    return null;
  }
}

// A check-in from an email typed at the customer screen is recorded with
// this device prefix (display/customer/actions.ts). Anyone can type anyone's
// email, so it doesn't prove who's standing there.
export const EMAIL_DEVICE = "screen-email:";

// True when the member's latest check-in today (the last 12 hours) was by a
// typed email at the screen: Spend points on the screen stays shut for them
// until they check in by phone (or at the door). Staff can still redeem for
// them on the register, where they see who it is. True when it can't tell.
export async function walletShutByEmail(memberId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("checkin_attempts")
    .select("device")
    .eq("member_id", memberId)
    .gte("at", new Date(Date.now() - 12 * 3_600_000).toISOString())
    .order("at", { ascending: false })
    .limit(1);
  if (error) return true;
  const device = (data?.[0]?.device as string | undefined) ?? "";
  return device.startsWith(EMAIL_DEVICE);
}
