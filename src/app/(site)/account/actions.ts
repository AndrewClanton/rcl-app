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
    // Case-insensitive -- members.email has a case-insensitive unique
    // index (lower(email)), so an exact match here could miss an existing
    // row that differs only in case and then fail the insert below with a
    // duplicate-key error instead of claiming it.
    const { data: existingByEmail } = await admin.from("members").select("id").ilike("email", user.email).maybeSingle();
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

// Shown on the customer-facing kiosk (see /display/customer) after a
// phone-number lookup. Same upload pattern as uploadBoothPhoto -- a
// timestamped filename avoids needing to delete the old file first.
export async function uploadAvatar(formData: FormData): Promise<void> {
  const member = await requireMember();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a photo to upload.");
  if (!file.type.startsWith("image/")) throw new Error("File must be an image.");

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${member.id}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage.from("member-avatars").upload(path, buffer, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = admin.storage.from("member-avatars").getPublicUrl(path);
  const { error } = await admin.from("members").update({ avatar_url: urlData.publicUrl }).eq("id", member.id);
  if (error) throw error;
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
