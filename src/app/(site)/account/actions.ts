"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/member-auth";
import { getStripe } from "@/lib/stripe";
import { googlePhotoUrl, linkMemberForUser } from "@/lib/member-link";

// Called right after an email/password sign-in or sign-up in the browser.
// (Google sign-in links on the server, in /account/callback.)
export async function linkMemberAccount(name?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const result = await linkMemberForUser(user, name);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
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

// Next.js redacts a *thrown* Server Action error's message in production
// builds (only a generic "Minified React error..." reaches the client --
// the real text only ever shows in dev). Expected, user-actionable errors
// are modeled as return values instead, per Next's own guidance, so the
// real message reaches the client in every environment. Genuine
// unexpected failures (a Storage/DB error) are left as throws below.
export type UploadAvatarResult = { ok: true } | { ok: false; error: string };

// Shown on the customer-facing kiosk (see /display/customer) after a
// phone-number lookup. Same upload pattern as uploadBoothPhoto -- a
// timestamped filename avoids needing to delete the old file first.
export async function uploadAvatar(formData: FormData): Promise<UploadAvatarResult> {
  const member = await requireMember();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo to upload." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "File must be an image." };
  if (file.size > 8_000_000) return { ok: false, error: "That photo is over 8 MB. Try a smaller one." };

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${member.id}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage.from("member-avatars").upload(path, buffer, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = admin.storage.from("member-avatars").getPublicUrl(path);
  const { error } = await admin.from("members").update({ avatar_url: urlData.publicUrl }).eq("id", member.id);
  if (error) throw error;
  revalidatePath("/account", "layout");
  return { ok: true };
}

export type BillingPortalResult = { ok: true; url: string } | { ok: false; error: string };

export async function startBillingPortal(): Promise<BillingPortalResult> {
  const member = await requireMember();
  if (!member.stripe_customer_id) return { ok: false, error: "No subscription on file." };
  const origin = await siteOrigin();
  const session = await getStripe().billingPortal.sessions.create({
    customer: member.stripe_customer_id,
    return_url: `${origin}/account/billing`,
  });
  return { ok: true, url: session.url };
}

export type ProfileResult = { ok: true } | { ok: false; error: string };

// Members can fix their own name and phone. Email is how they sign in, so
// it isn't editable here.
export async function updateMyProfile(fields: { name: string; phone: string }): Promise<ProfileResult> {
  const member = await requireMember();
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };
  const phone = fields.phone.trim();
  if (phone && phone.replace(/D/g, "").length < 10) return { ok: false, error: "Enter a full phone number, with area code." };
  const { error } = await createAdminClient().from("members").update({ name, phone: phone || null }).eq("id", member.id);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/account", "layout");
  return { ok: true };
}

export async function setEmailOptIn(optIn: boolean): Promise<ProfileResult> {
  const member = await requireMember();
  const { error } = await createAdminClient()
    .from("members")
    .update({ email_opt_in: optIn, email_opt_in_changed_at: new Date().toISOString() })
    .eq("id", member.id);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/account", "layout");
  return { ok: true };
}

// Copies the photo from their Google account into our own storage (so it
// keeps working if they change it on Google).
export async function importGooglePhoto(): Promise<ProfileResult> {
  const member = await requireMember();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const url = user ? googlePhotoUrl(user) : null;
  if (!url) return { ok: false, error: "There's no Google photo on this account." };
  const res = await fetch(url).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !type.startsWith("image/")) return { ok: false, error: "Couldn't get your Google photo. Try uploading one instead." };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 5_000_000) return { ok: false, error: "That photo is too large. Try uploading one instead." };
  const admin = createAdminClient();
  const path = `${member.id}-${Date.now()}.${type.includes("png") ? "png" : "jpg"}`;
  const { error: uploadErr } = await admin.storage.from("member-avatars").upload(path, buffer, { contentType: type });
  if (uploadErr) return { ok: false, error: "Couldn't save your photo. Try again." };
  const { data } = admin.storage.from("member-avatars").getPublicUrl(path);
  await admin.from("members").update({ avatar_url: data.publicUrl }).eq("id", member.id);
  revalidatePath("/account", "layout");
  return { ok: true };
}

export async function removeMyPhoto(): Promise<ProfileResult> {
  const member = await requireMember();
  await createAdminClient().from("members").update({ avatar_url: null }).eq("id", member.id);
  revalidatePath("/account", "layout");
  return { ok: true };
}
