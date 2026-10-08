"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { applyMemberRate, type RateChangeResult } from "@/lib/member-rate";
import type { MemberPriceTier, MemberTier } from "@/lib/types";
import { flairKeys, parseFlair, type FlairKeys } from "@/lib/flair";
import { displayNameFor, visibleLine, type ProfileMemberRow } from "@/lib/member-profile";
import { BADGES, birthdayWeekYear, visitBusinessDate } from "@/lib/visits";
import { sealTabletPhoto } from "@/lib/tablet-photo";
import { sealWallet, walletShutByEmail } from "@/lib/tablet-wallet";
import { lifetimeTotals, lookOf, sweepPerks } from "@/lib/rewards-server";
import type { TabletProfile } from "@/lib/registerChannel";
import { dailyCoffeeToday } from "@/lib/daily-perk-server";
import { currentMemberId } from "@/lib/member-forward";
import type { DailyCoffeeState } from "@/lib/daily-perk";
import { legacyNeedsSetup } from "@/lib/legacy-plus";
import { plusPaidFor } from "@/lib/plus-status";
import { hasName, isPhoneAccount, memberLabel } from "@/lib/member-name";
import { cleanEmail, cleanFirstName, formatPhone, isFullPhone, phoneDigits } from "@/lib/checkin";
import { memberIdsWithPhone, memberIdWithEmail } from "@/lib/checkin-server";
import { allowAttempt } from "@/lib/rate-limit";
import { setMarketingOptIn } from "@/lib/email/consent";

// What the register needs to know about an attached member -- looked up on
// demand instead of shipping every member's contact details to the register
// page (which also silently stopped at 1,000 members).
export interface PosMember {
  id: string;
  // Their name, or "Guest ·· 0199" for a phone account with none yet
  // (lib/member-name.ts): always something to show.
  name: string;
  // False when that's the "Guest ·· 0199" stand-in: "Add name" on the
  // member box. Optional for a member put together before this was added.
  named?: boolean;
  // A phone account (no email, no website login): the member box's "phone
  // only" tag and "Add email".
  phoneOnly?: boolean;
  email: string | null;
  phone: string | null;
  tier: MemberTier;
  points: number;
  comped: boolean;
  subscribed: boolean;
  price_tier: MemberPriceTier | null;
  price_tier_set_at: string | null;
  price_tier_set_by_name: string | null;
  avatar_url: string | null;
  // Their profile line (lib/member-profile.ts), for staff and the check-in
  // screen. Null while staff have it hidden.
  tagline: string | null;
  // Their check-in flair (lib/flair.ts) as catalog keys: the customer
  // screen plays it when they're confirmed, and Checked in today shows their
  // color. partyWeek: it's their birthday week and they want the party.
  flair?: FlairKeys;
  partyWeek?: boolean;
  // Has a website login. Without one, their receipt gets a "claim your
  // account" QR code (claim-actions.ts).
  hasLogin: boolean;
  // Paid for unlimited on the old website and nothing here is paying for it
  // yet (lib/legacy-plus.ts): the register shows "No payment on file for
  // unlimited membership" with ways to set it up.
  legacyUnlimited: boolean;
  // Something pays for their Insiders+ (lib/plus-status.ts plusPaidFor: a
  // live subscription, complimentary, or a gifted year): the register's gold
  // Insiders+ look (member-signal.ts). Optional for a member put together on
  // the register before this was added.
  plusPaid?: boolean;
}

// `*` rather than a column list, so the register keeps working before a
// migration adds a column it reads (the profile ones are simply missing
// until then). toPosMember picks out only what the register gets.
const POS_MEMBER_SELECT = "*, set_by:employees!members_price_tier_set_by_fkey(name)";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tier: MemberTier;
  points: number;
  comped: boolean | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  price_tier: MemberPriceTier | null;
  price_tier_set_at: string | null;
  avatar_url: string | null;
  tagline: string | null;
  auth_user_id: string | null;
  set_by: { name: string } | { name: string }[] | null;
  // From the member_profiles migration on.
  tagline_hidden_at?: string | null;
  flair_color?: string | null;
  flair_effect?: string | null;
  flair_sticker?: string | null;
  birthday?: string | null;
  birthday_party?: boolean | null;
  plus_gift_until?: string | null;
  legacy_plus?: boolean | null;
  // From the legacy_unlimited_onboarding migration on.
  legacy_onboarded_at?: string | null;
};

function toPosMember(r: Row): PosMember {
  const setBy = Array.isArray(r.set_by) ? r.set_by[0] : r.set_by;
  return {
    id: r.id,
    name: memberLabel(r.name, r.phone),
    named: hasName(r.name),
    phoneOnly: isPhoneAccount(r),
    email: r.email,
    phone: r.phone,
    tier: r.tier,
    points: Number(r.points),
    comped: !!r.comped,
    subscribed: !!r.stripe_subscription_id && ["active", "trialing", "past_due"].includes(r.subscription_status ?? ""),
    price_tier: r.price_tier,
    price_tier_set_at: r.price_tier_set_at,
    price_tier_set_by_name: setBy?.name ?? null,
    avatar_url: r.avatar_url,
    tagline: visibleLine(r),
    flair: flairKeys(parseFlair(r)),
    partyWeek: r.birthday_party !== false && birthdayWeekYear(r.birthday, visitBusinessDate(new Date())) !== null,
    // Only whether there is one: the login's id never goes to the register.
    hasLogin: !!r.auth_user_id,
    legacyUnlimited: legacyNeedsSetup({ ...r, comped: !!r.comped }),
    plusPaid: plusPaidFor({ ...r, comped: !!r.comped, plus_gift_until: r.plus_gift_until ?? null }),
  };
}

// A member's QR code (account page) encodes "RCL:<member id>". A USB or
// Bluetooth scanner types that into the search box like a keyboard.
const QR_PATTERN = /^RCL:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function getPosMember(id: string): Promise<PosMember | null> {
  await assertStaff();
  const { data } = await createAdminClient().from("members").select(POS_MEMBER_SELECT).eq("id", id).is("erased_at", null).maybeSingle();
  return data ? toPosMember(data as unknown as Row) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An Insiders+ member's free daily coffee today (lib/daily-perk.ts): still
// ready, or when it went. Looked up when they're put on an order. Null when
// it couldn't be read; the register then doesn't offer it.
export async function getDailyCoffee(memberId: string): Promise<DailyCoffeeState | null> {
  await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return null;
  // The account a merged-away member became, as the sale will be saved.
  const id = await currentMemberId(memberId);
  return id ? dailyCoffeeToday(id) : null;
}

// The member's card for the customer screen while nothing's rung up yet
// (lib/registerChannel.ts TabletProfile): their display name, photo (by a
// sealed reference, lib/tablet-photo.ts), profile line, color and entrance,
// badges, and what's still missing on their Profile tab. Shown to them, in
// front of them, so it doesn't wait for their page to be shared; never an
// email, phone, full name or member id. Null if it couldn't be read.
export async function getTabletProfile(memberId: string): Promise<TabletProfile | null> {
  await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return null;
  const supabase = createAdminClient();
  // A timed perk that ran out shows the default again.
  await sweepPerks(memberId);
  const [{ data, error }, earned, totals, emailOnly] = await Promise.all([
    supabase.from("members").select("*").eq("id", memberId).is("erased_at", null).maybeSingle(),
    supabase.from("member_badges").select("badge").eq("member_id", memberId),
    lifetimeTotals(memberId).catch(() => null),
    walletShutByEmail(memberId),
  ]);
  if (error || !data) return null;
  const row = data as unknown as ProfileMemberRow & { id: string };
  const flair = parseFlair(row);
  const have = new Set((earned.data ?? []).map((r) => r.badge as string));
  return {
    name: displayNameFor(row),
    photo: row.avatar_url ? sealTabletPhoto(row.id) : null,
    line: visibleLine(row),
    color: flair.color?.key ?? null,
    entrance: flair.effect === "classic" ? null : flair.effect,
    badges: BADGES.filter((b) => have.has(b.key)).map((b) => b.key),
    todo: { photo: !row.avatar_url, line: !row.tagline?.trim(), flair: !flair.color && flair.effect === "classic" },
    // No Spend points on the screen for someone checked in by a typed email
    // (lib/tablet-wallet.ts walletShutByEmail); staff redeem for them here.
    ...(emailOnly ? {} : { wallet: sealWallet(row.id) }),
    look: lookOf(row as unknown as Record<string, unknown>),
    ...(totals ? { earned: totals.earned } : {}),
  };
}

// Several members at once (the register's "here today" list), in the order asked.
export async function getPosMembers(ids: string[]): Promise<PosMember[]> {
  await assertStaff();
  if (!ids.length) return [];
  const { data } = await createAdminClient().from("members").select(POS_MEMBER_SELECT).in("id", ids.slice(0, 100)).is("erased_at", null);
  const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.id, toPosMember(r)]));
  return ids.map((id) => byId.get(id)).filter((m): m is PosMember => !!m);
}

// Name, email, phone (any formatting), or a scanned member QR code.
export async function searchPosMembers(query: string, limit = 8): Promise<PosMember[]> {
  const staff = await assertStaff();
  // A cashier gets each match's email and phone shortened (j•••@gmail.com,
  // ••1234): enough to tell two Sarahs apart. The match itself still runs
  // on the full details in the database, and attaching only needs the id.
  const { contactForRole } = await import("@/lib/contact-mask");
  const forViewer = (m: PosMember) => contactForRole(m, staff.role);
  const q = query.trim();
  const qr = q.match(QR_PATTERN);
  if (qr) {
    const member = await getPosMember(qr[1]);
    return member ? [forViewer(member)] : [];
  }
  // Characters that would break PostgREST's or() syntax, plus escaped wildcards.
  const text = q.replace(/[,()"*\\]/g, " ").replace(/[%_]/g, (c) => `\\${c}`).trim();
  if (text.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const filters = [`name.ilike.%${text}%`, `email.ilike.%${text}%`];
  if (digits.length >= 3) filters.push(`phone_digits.like.%${digits}%`);

  const { data, error } = await createAdminClient().from("members").select(POS_MEMBER_SELECT).is("erased_at", null).or(filters.join(",")).order("name").limit(Math.min(Math.max(limit, 1), 40));
  if (error) return [];
  return (data as unknown as Row[]).map(toPosMember).map(forViewer);
}

// Only after checking the person's ID in person. `employeeId` is whoever is
// signed in to the register's employee picker, falling back to the logged-in
// staff account.
export async function setPosMemberRate(
  memberId: string,
  tier: MemberPriceTier,
  employeeId: string | null
): Promise<RateChangeResult & { member?: PosMember | null }> {
  const staff = await assertStaff();
  const result = await applyMemberRate(memberId, tier, employeeId || staff.employeeId);
  revalidatePath("/admin/members");
  if (!result.ok) return result;
  return { ...result, member: await getPosMember(memberId) };
}

export interface Regular {
  member: PosMember;
  visits: number;
  lastVisit: string | null;
}

// Suggestions for the register's photo lookup: whoever came in on the most
// different days in the last 90. Until there's enough history, fills in
// with members who've added a photo.
export async function getRegulars(): Promise<Regular[]> {
  await assertStaff();
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: freq } = await supabase.rpc("frequent_members", { p_since: since, p_limit: 24 });
  const ranked = (freq ?? []) as { member_id: string; visits: number; last_visit: string }[];

  const out: Regular[] = [];
  if (ranked.length) {
    const { data } = await supabase.from("members").select(POS_MEMBER_SELECT).is("erased_at", null).in("id", ranked.map((r) => r.member_id));
    const byId = new Map((data as unknown as Row[] | null ?? []).map((r) => [r.id, toPosMember(r)]));
    for (const r of ranked) {
      const m = byId.get(r.member_id);
      if (m) out.push({ member: m, visits: Number(r.visits), lastVisit: r.last_visit });
    }
  }
  if (out.length < 24) {
    const have = new Set(out.map((r) => r.member.id));
    const { data } = await supabase.from("members").select(POS_MEMBER_SELECT).is("erased_at", null).not("avatar_url", "is", null).order("created_at", { ascending: false }).limit(24);
    for (const r of (data as unknown as Row[] | null) ?? []) {
      if (out.length >= 24) break;
      if (!have.has(r.id)) out.push({ member: toPosMember(r), visits: 0, lastVisit: null });
    }
  }
  return out;
}

// ---------- phone accounts (lib/member-name.ts) ----------

export type PhoneAccountResult = { ok: true; member: PosMember; made: boolean; message: string } | { ok: false; error: string };

const OFFLINE = "Couldn't reach the database. Check the connection and try again.";
const BUSY = "Too many changes at once. Wait a minute, then try again.";

// "New phone account" on the register: a guest standing there gives their
// number (and maybe a first name), and that's their account: Insiders,
// points from today, email marketing off, nothing sent anywhere. A number
// that's on an account already gets that account instead of a second one.
export async function createPhoneMember(fields: { phone: string; firstName?: string | null }): Promise<PhoneAccountResult> {
  const staff = await assertStaff();
  const digits = phoneDigits(String(fields?.phone ?? ""));
  if (!isFullPhone(digits)) return { ok: false, error: "Type their full phone number, area code first." };
  const rawFirst = String(fields?.firstName ?? "").trim();
  const first = rawFirst ? cleanFirstName(rawFirst) : null;
  if (rawFirst && !first) return { ok: false, error: "A first name is letters only. Fix it, or leave it blank." };
  if (!(await allowAttempt(`pos-phone-account:${staff.employeeId}`, 20, 300))) return { ok: false, error: BUSY };

  const taken = await memberIdsWithPhone(digits);
  if (!taken.ok) return { ok: false, error: OFFLINE };
  if (taken.ids.length) {
    const m = await getPosMember(taken.ids[0]);
    if (!m) return { ok: false, error: OFFLINE };
    const more = taken.ids.length > 1 ? ` (${taken.ids.length} accounts share that number: check it's the right one)` : "";
    return { ok: true, member: m, made: false, message: `That number already has an account: ${m.name}${more}.` };
  }

  const { data, error } = await createAdminClient()
    .from("members")
    .insert({ name: first ?? "", phone: formatPhone(digits), email: null, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't make the account. Try again." };
  const m = await getPosMember(data.id as string);
  if (!m) return { ok: false, error: OFFLINE };
  revalidatePath("/admin/members");
  return { ok: true, member: m, made: true, message: `Phone account made: ${m.name}. Next time they just type their number at check-in.` };
}

export type MemberEditResult = { ok: true; member: PosMember; message: string } | { ok: false; error: string };

// "Add name" on the member box, for an account with none yet. First name,
// and a last name or initial if they like. Changing a name that's there is
// Back office's job.
export async function addPosMemberName(memberId: string, fields: { firstName: string; lastName?: string | null }): Promise<MemberEditResult> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  const first = cleanFirstName(String(fields?.firstName ?? ""));
  if (!first) return { ok: false, error: "Type their first name (letters only)." };
  const rawLast = String(fields?.lastName ?? "").trim();
  const last = rawLast ? cleanFirstName(rawLast) : null;
  if (rawLast && !last) return { ok: false, error: "A last name is letters only. Fix it, or leave it blank." };
  if (!(await allowAttempt(`pos-member-edit:${staff.employeeId}`, 30, 300))) return { ok: false, error: BUSY };

  const admin = createAdminClient();
  const { data: before, error } = await admin.from("members").select("name").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (error || !before) return { ok: false, error: "Couldn't find that member." };
  const was = (before.name as string | null) ?? "";
  if (hasName(was)) return { ok: false, error: "They have a name on file already. Change it in Back office." };
  const name = last ? `${first} ${last}` : first;
  // Only over what was there when read (no name).
  const { data: saved, error: saveErr } = await admin.from("members").update({ name }).eq("id", memberId).eq("name", was).select("id");
  if (saveErr || !saved?.length) return { ok: false, error: "Couldn't save the name. Try again." };
  const m = await getPosMember(memberId);
  if (!m) return { ok: false, error: OFFLINE };
  revalidatePath("/admin/members");
  return { ok: true, member: m, message: `Name saved: ${name}${name.endsWith(".") ? "" : "."}` };
}

// "Add email" on the member box, for an account with none: the guest asked
// for it, standing there. Marketing stays off unless they said yes to our
// emails. With an email they can sign in on the website (with that
// address) and see their points; nothing else about the account changes.
export async function addPosMemberEmail(memberId: string, fields: { email: string; optIn?: boolean }): Promise<MemberEditResult> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  const email = cleanEmail(String(fields?.email ?? ""));
  if (!email) return { ok: false, error: "That email doesn't look right. Check it with them." };
  if (!(await allowAttempt(`pos-member-edit:${staff.employeeId}`, 30, 300))) return { ok: false, error: BUSY };

  const TAKEN = "That email is on another account. Search for it: they may have one already.";
  const admin = createAdminClient();
  const { data: before, error } = await admin.from("members").select("email").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (error || !before) return { ok: false, error: "Couldn't find that member." };
  const was = (before.email as string | null) ?? null;
  if (was?.trim()) return { ok: false, error: "They have an email on file already. Change it in Back office." };
  if (await memberIdWithEmail(email)) return { ok: false, error: TAKEN };
  const update = admin.from("members").update({ email, email_opt_in: false, email_opt_in_changed_at: new Date().toISOString() }).eq("id", memberId);
  const { data: saved, error: saveErr } = await (was === null ? update.is("email", null) : update.eq("email", was)).select("id");
  if (saveErr?.code === "23505") return { ok: false, error: TAKEN };
  if (saveErr || !saved?.length) return { ok: false, error: "Couldn't save the email. Try again." };
  let note = "";
  if (fields?.optIn === true) {
    const r = await setMarketingOptIn(memberId, true, "staff", { byEmployee: staff.employeeId }).catch(() => null);
    note = r?.ok ? " They'll get our emails." : " Couldn't switch on our emails just now; do it in Back office.";
  }
  const m = await getPosMember(memberId);
  if (!m) return { ok: false, error: OFFLINE };
  revalidatePath("/admin/members");
  return { ok: true, member: m, message: `Email saved.${note}` };
}
