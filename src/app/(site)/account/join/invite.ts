import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// An organization's helper invite (organizations.invite_code): open
// organizations only.
export async function readInvite(code: string | null | undefined): Promise<{ id: string; name: string } | null> {
  const c = String(code ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{20,64}$/.test(c)) return null;
  const { data } = await createAdminClient().from("organizations").select("id, name, status").eq("invite_code", c).maybeSingle();
  if (!data || data.status === "closed") return null;
  return { id: data.id as string, name: data.name as string };
}

// A work login stays separate from a personal one: a login with its own
// Insiders+ membership is someone's personal account.
export function personalAccountReason(m: { tier?: string | null; stripe_subscription_id?: string | null }): string | null {
  if (m.stripe_subscription_id || m.tier === "Insiders+") {
    return "This login has a personal Insiders+ membership. Sign out, then sign up with your work email so your work account stays separate.";
  }
  return null;
}
