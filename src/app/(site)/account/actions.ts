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
import { cleanDisplayName, cleanProfileLine, handleProblem, normalizeHandle } from "@/lib/member-profile";
import { flairColor, isFlairEffect, isSticker } from "@/lib/flair";
import { allowAttempt } from "@/lib/rate-limit";

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

// Members can fix their own name and phone, write their profile line (on
// their shared profile page and the check-in screen; lib/member-profile.ts),
// and give their birthday (month and day, "12-30", for the Birthday Visit
// badge; "" removes it). Email is how they sign in, so it isn't editable
// here. A line staff hid stays hidden when it's edited.
export async function updateMyProfile(fields: { name: string; phone: string; tagline?: string; birthday?: string }): Promise<ProfileResult> {
  const member = await requireMember();
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };
  const phone = fields.phone.trim();
  if (phone && phone.replace(/\D/g, "").length < 10) return { ok: false, error: "Enter a full phone number, with area code." };
  const line = cleanProfileLine(fields.tagline);
  if (!line.ok) return { ok: false, error: line.error };
  const tagline = line.value ?? "";
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

// ---------- the shared profile page and check-in flair ----------
// (lib/member-profile.ts, lib/flair.ts)

// Before the member_profiles migration the columns aren't there yet.
function missingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
const NOT_YET = "Profile pages and check-in effects aren't switched on yet. Try again soon.";

export type SharingResult = { ok: true; handle: string | null; displayName: string | null } | { ok: false; error: string };

// Their profile page: on or off, its link name and the name on it.
// Turning it off keeps the link name for next time. A new link name works
// at once and the old one stops (pages are found by the current name
// only); the database holds the old one for them for HANDLE_HOLD_DAYS
// (member_retired_handles), so nobody else can take it over meanwhile.
// Staff can turn a page off; then it stays off until they allow it.
// Returns what was saved, tidied, for the form to show.
export async function updateSharing(fields: { share: boolean; handle: string; displayName: string }): Promise<SharingResult> {
  const member = await requireMember();
  if (!fields || typeof fields !== "object") return { ok: false, error: "Couldn't save. Try again." };
  if (!(await allowAttempt(`profile-sharing:${member.id}`, 20, 600))) return { ok: false, error: "That's a lot of changes. Try again in a few minutes." };
  const share = fields.share === true;
  if (share && member.profile_hidden_at) {
    return { ok: false, error: "Our staff turned off your profile page. Email info@royalecinemajoplin.com if you think that's a mistake." };
  }
  const handle = normalizeHandle(fields.handle);
  if (share || handle) {
    const problem = handleProblem(handle);
    if (problem) return { ok: false, error: problem };
  }
  const name = cleanDisplayName(fields.displayName);
  if (!name.ok) return { ok: false, error: name.error };
  const { error } = await createAdminClient()
    .from("members")
    .update({ share_profile: share, profile_handle: handle || null, display_name: name.value })
    .eq("id", member.id)
    .is("erased_at", null);
  // Taken, or held for whoever had it until recently: the same answer.
  if (error?.code === "23505") return { ok: false, error: "Someone has (or recently had) that link. Try another." };
  if (missingColumn(error)) return { ok: false, error: NOT_YET };
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/account", "layout");
  return { ok: true, handle: handle || null, displayName: name.value };
}

// Their check-in flair: a color from the palette (null for the Royale's
// own), an effect, a sticker for Floating reactions, and whether their
// birthday week gets the party.
export async function updateFlair(fields: { color: string | null; effect: string; sticker: string; birthdayParty: boolean }): Promise<ProfileResult> {
  const member = await requireMember();
  if (!fields || typeof fields !== "object") return { ok: false, error: "Couldn't save. Try again." };
  if (!(await allowAttempt(`profile-flair:${member.id}`, 30, 600))) return { ok: false, error: "That's a lot of changes. Try again in a few minutes." };
  const color = fields.color === null ? null : (flairColor(fields.color)?.key ?? undefined);
  if (color === undefined) return { ok: false, error: "Pick one of the colors." };
  if (!isFlairEffect(fields.effect)) return { ok: false, error: "Pick one of the effects." };
  if (!isSticker(fields.sticker)) return { ok: false, error: "Pick one of the stickers." };
  const { error } = await createAdminClient()
    .from("members")
    .update({ flair_color: color, flair_effect: fields.effect, flair_sticker: fields.sticker, birthday_party: fields.birthdayParty !== false })
    .eq("id", member.id)
    .is("erased_at", null);
  if (missingColumn(error)) return { ok: false, error: NOT_YET };
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/account", "layout");
  return { ok: true };
}
