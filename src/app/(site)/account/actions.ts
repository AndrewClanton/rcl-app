"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/member-auth";
import { getStripe } from "@/lib/stripe";

// Called right after the browser client establishes a session (sign-up or
// sign-in). Links that auth user to a `members` row -- claiming an existing
// row by email if one exists (e.g. someone who signed up for Insiders or
// bought a ticket before this account system existed), or creating a fresh
// free-Insiders row otherwise. `name` is only used when creating a new row
// (a returning member keeps whatever name is already on file).
export async function linkMemberAccount(name?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in." };

  const admin = createAdminClient();
  const { data: existingByAuth } = await admin.from("members").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!existingByAuth) {
    const { data: existingByEmail } = await admin.from("members").select("id").eq("email", user.email).maybeSingle();
    if (existingByEmail) {
      await admin.from("members").update({ auth_user_id: user.id }).eq("id", existingByEmail.id);
    } else {
      await admin
        .from("members")
        .insert({ auth_user_id: user.id, name: name?.trim() || user.email.split("@")[0], email: user.email, tier: "Insiders", points: 0 });
    }
  }
  return { ok: true };
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function startBillingPortal(): Promise<{ url: string }> {
  const member = await requireMember();
  if (!member.stripe_customer_id) throw new Error("No subscription on file.");
  const origin = await siteOrigin();
  const session = await getStripe().billingPortal.sessions.create({
    customer: member.stripe_customer_id,
    return_url: `${origin}/account`,
  });
  return { url: session.url };
}
