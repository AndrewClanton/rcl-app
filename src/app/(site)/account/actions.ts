"use server";

import { siteOrigin } from "@/lib/site-origin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/member-auth";
import { getStripe } from "@/lib/stripe";
import { googlePhotoUrl, linkMemberForUser } from "@/lib/member-link";
import { setMarketingOptIn } from "@/lib/email/consent";
import { insidersPlusPriceIdFor } from "@/lib/member-rate";
import { ANNUAL_PRICE } from "@/lib/membership-rates";
import { birthdayFromInput } from "@/lib/visits";
import { cleanDisplayName, cleanProfileLine, handleProblem, normalizeHandle } from "@/lib/member-profile";
import { flairColor, isFlairEffect, isPaidEffect, isSticker } from "@/lib/flair";
import { ownedPerks, setLook } from "@/lib/rewards-server";
import { isPerkSlot } from "@/lib/rewards";
import { allowAttempt } from "@/lib/rate-limit";
import { safePath } from "@/lib/safe-path";
import { pendingClaimFor } from "@/lib/member-claim-token";
import { PHOTO_TYPES, deleteMemberPhotoFile } from "@/lib/member-photos";

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
  // Don't leave them half signed in to a login that owns nothing (this
  // device only).
  if (result.reason === "unproven") await supabase.auth.signOut({ scope: "local" });
  return { ok: false, error: result.error };
}

// Where the Reset password page sends someone once their new password is
// saved. A staff login goes to the back office and is never linked to a
// member account: linking one whose email also has a member row used to
// sign them out right after the password saved, so the page showed
// "Auth session missing!" on a second press (Caleb, 10/1).
export async function afterPasswordReset(): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your password is saved, but this page lost its sign-in. Sign in with your new password." };
  const { data: staff } = await createAdminClient().from("employees").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (staff) return { ok: true, to: "/admin" };
  const linked = await linkMemberAccount();
  return linked.ok ? { ok: true, to: "/account" } : linked;
}

// The link in a Supabase sign-up confirmation (or email change, or password
// reset) email, once its template points at /account/confirm. The page
// only verifies when the person presses its button, so a mail scanner that
// opens every link can't use up the one-time token first. Works in any
// browser: nothing from the sign-up browser is needed.
const OTP_TYPES = { email: "email", signup: "email", recovery: "recovery", email_change: "email_change", invite: "invite" } as const;

export async function confirmEmailLink(tokenHash: string, type: string, next: string | null): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const otpType = typeof type === "string" && Object.hasOwn(OTP_TYPES, type) ? OTP_TYPES[type as keyof typeof OTP_TYPES] : null;
  if (!otpType || typeof tokenHash !== "string" || !tokenHash || tokenHash.length > 500) {
    return { ok: false, error: "That link isn't complete. Copy the whole link from the email, or ask for a new one." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
  // "Secure email change" sends a link to the old address and the new one;
  // the first of the two comes back with no user yet.
  if (!error && !data.user && otpType === "email_change") {
    return { ok: false, error: "That's one of two links. Open the one we sent to your other email address too, to finish the change." };
  }
  if (error || !data.user) return { ok: false, error: "This link has expired or was already used. Sign in, or ask for a new one from the sign-in page." };
  // The Reset password page takes it from here (afterPasswordReset).
  if (otpType === "recovery") return { ok: true, to: "/account/reset-password" };
  // A staff login goes to the back office and is never linked to a member
  // account, as after a password reset.
  const { data: staff } = await createAdminClient().from("employees").select("id").eq("auth_user_id", data.user.id).maybeSingle();
  if (staff) return { ok: true, to: "/admin" };
  // A login made from a "claim your account" link goes back to that link,
  // which attaches it to the account the link was made for (and pays an
  // old-site member's claim bonus). Before linking: linking by email could
  // otherwise attach it first, to the same account, without the claim.
  const claim = await pendingClaimFor(data.user);
  if (claim) return { ok: true, to: claim };
  const linked = await linkMemberForUser(data.user);
  if (!linked.ok) {
    // Don't leave them half signed in to a login that owns nothing (this
    // device only).
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false, error: linked.error };
  }
  // Where they were headed when they signed up (e.g. Insiders+ payment);
  // the bare site address means nowhere in particular.
  const dest = safePath(next);
  return { ok: true, to: dest && dest !== "/account" && dest !== "/" ? dest : linked.created ? "/account?welcome=1" : "/account" };
}

// This device only (see app/login/actions.ts): a member signing out on a
// friend's laptop shouldn't end their session on their own phone.
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
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
  // Replacing a photo deletes the old file too, so it doesn't stay
  // reachable at its address (lib/member-photos.ts).
  await deleteMemberPhotoFile(member.avatar_url, member.id);
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

// The master switch for marketing email (the categories and the pause are
// on /account/email). Recorded and logged through lib/email/consent.ts.
export async function setEmailOptIn(optIn: boolean): Promise<ProfileResult> {
  const member = await requireMember();
  const r = await setMarketingOptIn(member.id, optIn === true, "account");
  if (!r.ok) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/account", "layout");
  return { ok: true };
}

// ---------- linked cards (lib/member-cards.ts) ----------

// Takes a card off their account: it stops earning them points without
// signing in, and isn't linked to them again on its own. Its type and last
// four digits are deleted; only Stripe's code for it stays, so it's
// recognized and not linked again. Only their own. (Staff removing one does
// the same: admin/members/actions.ts, pos/card-link-actions.ts.)
export async function removeMyCard(cardId: string): Promise<ProfileResult> {
  const member = await requireMember();
  if (typeof cardId !== "string" || !cardId) return { ok: false, error: "Couldn't remove it. Try again." };
  const { data, error } = await createAdminClient()
    .from("member_cards")
    .update({ removed_at: new Date().toISOString(), removed_by_member: true, brand: null, last4: null, wallet: null })
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
  // The same four photo types as an upload; the stored name and type come
  // from that list, not from what Google's server says.
  const type = (res?.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = PHOTO_TYPES[type];
  if (!res?.ok || !ext) return { ok: false, error: "Couldn't get your Google photo. Try uploading one instead." };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 5_000_000) return { ok: false, error: "That photo is too large. Try uploading one instead." };
  const admin = createAdminClient();
  const path = `${member.id}-${Date.now()}.${ext}`;
  const { error: uploadErr } = await admin.storage.from("member-avatars").upload(path, buffer, { contentType: type });
  if (uploadErr) return { ok: false, error: "Couldn't save your photo. Try again." };
  const { data } = admin.storage.from("member-avatars").getPublicUrl(path);
  const { error } = await admin.from("members").update({ avatar_url: data.publicUrl }).eq("id", member.id);
  if (error) {
    // Not saved on the account: the new file goes, the old photo stays.
    await deleteMemberPhotoFile(data.publicUrl, member.id);
    return { ok: false, error: "Couldn't save your photo. Try again." };
  }
  await deleteMemberPhotoFile(member.avatar_url, member.id);
  revalidatePath("/account", "layout");
  return { ok: true };
}

export async function removeMyPhoto(): Promise<ProfileResult> {
  const member = await requireMember();
  const { error } = await createAdminClient().from("members").update({ avatar_url: null }).eq("id", member.id);
  if (error) return { ok: false, error: "Couldn't remove your photo. Try again." };
  await deleteMemberPhotoFile(member.avatar_url, member.id);
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

// Their check-in flair: a color from the palette (null for Royale Cinema's
// own), an effect, a sticker for Floating reactions, and whether their
// birthday week gets the party.
// What they show of the perks they unlocked with points (a sign-in sound,
// a card frame, a name color, a title): one they own, or null for the
// default. Checked on the server (lib/rewards-server.ts setLook).
export async function updateLook(slot: string, key: string | null): Promise<ProfileResult> {
  const member = await requireMember();
  if (!isPerkSlot(slot) || slot === "entrance" || slot === "mobile") return { ok: false, error: "That isn't one of the choices." };
  if (!(await allowAttempt(`profile-look:${member.id}`, 40, 600))) return { ok: false, error: "That's a lot of changes. Try again in a few minutes." };
  const r = await setLook(member.id, slot, typeof key === "string" ? key : null);
  if (r.ok) revalidatePath("/account", "layout");
  return r;
}

export async function updateFlair(fields: { color: string | null; effect: string; sticker: string; birthdayParty: boolean }): Promise<ProfileResult> {
  const member = await requireMember();
  if (!fields || typeof fields !== "object") return { ok: false, error: "Couldn't save. Try again." };
  if (!(await allowAttempt(`profile-flair:${member.id}`, 30, 600))) return { ok: false, error: "That's a lot of changes. Try again in a few minutes." };
  const color = fields.color === null ? null : (flairColor(fields.color)?.key ?? undefined);
  if (color === undefined) return { ok: false, error: "Pick one of the colors." };
  if (!isFlairEffect(fields.effect)) return { ok: false, error: "Pick one of the effects." };
  // An entrance bought with points: only once it's theirs.
  if (isPaidEffect(fields.effect) && !(await ownedPerks(member.id)).some((o) => o.slot === "entrance" && o.key === fields.effect)) {
    return { ok: false, error: "Unlock that entrance with points first (Spend points, on the screen at the bar)." };
  }
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
