"use server";

import { siteOrigin } from "@/lib/site-origin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/member-auth";
import { getStripe } from "@/lib/stripe";
import { googlePhotoUrl, linkMemberForUser } from "@/lib/member-link";
import { insidersPlusPriceIdFor } from "@/lib/member-rate";
import { ANNUAL_PRICE } from "@/lib/membership-rates";
import { birthdayFromInput } from "@/lib/visits";

// Called right after an email/password sign-in or sign-up in the browser.
// (Google sign-in links on the server, in /account/callback.)
export async function linkMemberAccount(name?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const result = await linkMemberForUser(user, name);
  if (result.ok) return { ok: true };
  // Don't leave them half signed in to a login that owns nothing.
  if (result.reason === "unproven") await supabase.auth.signOut();
  return { ok: false, error: result.error };
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
  // Photos only (no SVG, which can carry script), and the stored name comes
  // from the type we allow, never from the uploaded file's name.
  const ext = PHOTO_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a JPG, PNG, WebP or GIF photo." };
  if (file.size > 8_000_000) return { ok: false, error: "That photo is over 8 MB. Try a smaller one." };

  const admin = createAdminClient();
  const path = `${member.id}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage.from("member-avatars").upload(path, buffer, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = admin.storage.from("member-avatars").getPublicUrl(path);
  const { error } = await admin.from("members").update({ avatar_url: urlData.publicUrl }).eq("id", member.id);
  if (error) throw error;
  await deleteStoredPhoto(member.avatar_url);
  revalidatePath("/account", "layout");
  return { ok: true };
}

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Removing or replacing a photo deletes the stored file too, so the old
// picture doesn't stay reachable at its address.
async function deleteStoredPhoto(url: string | null | undefined) {
  const marker = "/storage/v1/object/public/member-avatars/";
  const at = url?.indexOf(marker) ?? -1;
  if (!url || at < 0) return;
  const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
  await createAdminClient().storage.from("member-avatars").remove([path]).catch(() => {});
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

// Members can fix their own name and phone, write a short line about
// themselves (staff see it when they check in), and give their birthday
// (month and day, "12-30", for the Birthday Visit badge; "" removes it).
// Email is how they sign in, so it isn't editable here.
export async function updateMyProfile(fields: { name: string; phone: string; tagline?: string; birthday?: string }): Promise<ProfileResult> {
  const member = await requireMember();
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };
  const phone = fields.phone.trim();
  if (phone && phone.replace(/\D/g, "").length < 10) return { ok: false, error: "Enter a full phone number, with area code." };
  const tagline = (fields.tagline ?? "").replace(/\s+/g, " ").trim();
  if (tagline.length > 120) return { ok: false, error: "Keep your line to 120 characters." };
  const birthday = fields.birthday === undefined ? undefined : birthdayFromInput(fields.birthday);
  if (fields.birthday !== undefined && birthday === undefined) return { ok: false, error: "Pick both the month and the day of your birthday (or neither)." };
  const { error } = await createAdminClient()
    .from("members")
    .update({
      name,
      phone: phone || null,
      ...(fields.tagline !== undefined ? { tagline: tagline || null } : {}),
      ...(birthday !== undefined ? { birthday } : {}),
    })
    .eq("id", member.id);
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

// ---------- linked cards (lib/member-cards.ts) ----------

// Takes a card off their account: it stops earning them points without
// signing in, and isn't linked to them again on its own. Only their own.
export async function removeMyCard(cardId: string): Promise<ProfileResult> {
  const member = await requireMember();
  if (typeof cardId !== "string" || !cardId) return { ok: false, error: "Couldn't remove it. Try again." };
  const { data, error } = await createAdminClient()
    .from("member_cards")
    .update({ removed_at: new Date().toISOString(), removed_by_member: true })
    .eq("id", cardId)
    .eq("member_id", member.id)
    .is("removed_at", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };
  if (!data?.length) return { ok: false, error: "That card isn't linked to your account anymore." };
  revalidatePath("/account/profile");
  return { ok: true };
}

// Their switch for linking cards at all. Off: no new cards are linked, and
// the ones already linked stop finding them.
export async function setCardLinking(on: boolean): Promise<ProfileResult> {
  const member = await requireMember();
  const { error } = await createAdminClient().from("members").update({ link_cards: !!on }).eq("id", member.id);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/account/profile");
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
  await deleteStoredPhoto(member.avatar_url);
  revalidatePath("/account", "layout");
  return { ok: true };
}

export async function removeMyPhoto(): Promise<ProfileResult> {
  const member = await requireMember();
  await createAdminClient().from("members").update({ avatar_url: null }).eq("id", member.id);
  await deleteStoredPhoto(member.avatar_url);
  revalidatePath("/account", "layout");
  return { ok: true };
}

// ---------- switch Insiders+ from monthly to yearly (15% off) ----------
// The year starts the day they switch: they pay the yearly price now, less
// a credit for the unused part of the month they already paid for. If the
// card doesn't go through, nothing changes.

async function monthlySubscriptionFor(member: Awaited<ReturnType<typeof requireMember>>) {
  if (!member.stripe_subscription_id || !member.stripe_customer_id) return null;
  const sub = await getStripe().subscriptions.retrieve(member.stripe_subscription_id);
  const item = sub.items.data[0];
  if (!item || !["active", "trialing"].includes(sub.status) || item.price.recurring?.interval !== "month") return null;
  return { sub, item };
}

export type YearlyPreview = { ok: true; amountDue: number; yearly: number; renewsOn: string } | { ok: false; error: string };

export async function previewSwitchToYearly(): Promise<YearlyPreview> {
  const member = await requireMember();
  try {
    const current = await monthlySubscriptionFor(member);
    if (!current) return { ok: false, error: "Only a monthly Insiders+ membership can switch to yearly." };
    const tier = member.price_tier ?? "adult";
    const yearlyPrice = await insidersPlusPriceIdFor(tier, "year");
    if (!yearlyPrice) return { ok: false, error: "Yearly isn't available right now." };
    const preview = await getStripe().invoices.createPreview({
      customer: member.stripe_customer_id as string,
      subscription: current.sub.id,
      subscription_details: {
        items: [{ id: current.item.id, price: yearlyPrice, tax_rates: current.item.tax_rates?.map((r) => r.id) }],
        billing_cycle_anchor: "now",
        proration_behavior: "create_prorations",
      },
    });
    const renews = new Date();
    renews.setFullYear(renews.getFullYear() + 1);
    return { ok: true, amountDue: preview.amount_due / 100, yearly: ANNUAL_PRICE[tier], renewsOn: renews.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) };
  } catch {
    return { ok: false, error: "Couldn't work out the switch right now. Try again in a minute." };
  }
}

export async function switchToYearly(): Promise<{ ok: true } | { ok: false; error: string }> {
  const member = await requireMember();
  try {
    const current = await monthlySubscriptionFor(member);
    if (!current) return { ok: false, error: "Only a monthly Insiders+ membership can switch to yearly." };
    const yearlyPrice = await insidersPlusPriceIdFor(member.price_tier ?? "adult", "year");
    if (!yearlyPrice) return { ok: false, error: "Yearly isn't available right now." };
    await getStripe().subscriptions.update(current.sub.id, {
      items: [{ id: current.item.id, price: yearlyPrice, tax_rates: current.item.tax_rates?.map((r) => r.id) }],
      billing_cycle_anchor: "now",
      proration_behavior: "create_prorations",
      // Card declined: Stripe undoes the change instead of leaving it half done.
      payment_behavior: "error_if_incomplete",
    });
    await createAdminClient().from("members").update({ billing_interval: "year" }).eq("id", member.id);
    revalidatePath("/account");
    revalidatePath("/account/billing");
    return { ok: true };
  } catch (e) {
    const message = e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string" && "type" in e ? (e as { message: string }).message : null;
    return { ok: false, error: message ? `The switch didn't go through: ${message}` : "The switch didn't go through. Nothing was changed." };
  }
}
