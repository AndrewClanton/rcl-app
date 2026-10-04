import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { centralToIso } from "@/lib/ops/time";
import { giftActive, giftEndsWithoutRenewal, subscriptionLive } from "@/lib/plus-status";
import { currentGiftFrom } from "@/lib/gift-membership";
import { allowAttempt } from "@/lib/rate-limit";
import { maskEmail } from "@/lib/contact-mask";
import { sendEmail } from "@/lib/email/send";
import { paidThroughHtml, paidThroughSubject, paidThroughText } from "@/lib/email/paid-through-email";
import { SITE_URL } from "@/lib/site";
import type { BillingInterval } from "@/lib/membership-rates";
import type { Member, MemberPriceTier } from "@/lib/types";

// "Paid through": a member who paid for Insiders+ ahead another way (a
// whole year on the old website) has it until a date. It's the same column
// as a gifted year, members.plus_gift_until, so everything that honors a
// gift honors it too (lib/plus-status.ts): they're paid-for Insiders+ (gold
// at the register, all the perks, no "no card" warning), and a card added
// before the date starts a subscription whose first charge waits until it
// (Stripe trial_end), at the plan it renews as. The daily gift expiry turns
// the perks off after the date unless a card is on by then.
//
// Owners and admins set or change it on the member's Back office page; each
// change is kept in member_paid_through with who and when (migration
// 20261003070000). Staff can email the member how to add their card
// without being charged early ("Send paid-through explainer").

export interface PaidThroughRecord {
  paidThrough: string | null;
  previous: string | null;
  renewsAs: BillingInterval;
  note: string | null;
  setBy: string | null;
  setAt: string;
}

export type PaidThroughResult = { ok: true; message: string } | { ok: false; error: string };

type Row = { paid_through: string | null; previous: string | null; renews_as: BillingInterval; note: string | null; set_at: string; staff: { name: string } | null };

// The latest change for a member, or null if staff never set one.
export async function getPaidThrough(memberId: string): Promise<PaidThroughRecord | null> {
  const { data } = await createAdminClient()
    .from("member_paid_through")
    .select("paid_through, previous, renews_as, note, set_at, staff:employees!member_paid_through_set_by_fkey(name)")
    .eq("member_id", memberId)
    .order("set_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = data as unknown as Row | null;
  if (!r) return null;
  return { paidThrough: r.paid_through, previous: r.previous, renewsAs: r.renews_as === "month" ? "month" : "year", note: r.note, setBy: r.staff?.name ?? null, setAt: r.set_at };
}

// The prepaid year that covers them now, if that's what plus_gift_until is
// (not a gift bought since): the record's date is the member's date.
export function prepaidInForce(member: Pick<Member, "plus_gift_until">, rec: PaidThroughRecord | null): PaidThroughRecord | null {
  if (!rec?.paidThrough || !member.plus_gift_until || !giftActive(member)) return null;
  return new Date(rec.paidThrough).getTime() === new Date(member.plus_gift_until).getTime() ? rec : null;
}

// What they had on the old website: "year" for an annual plan, "month" for
// monthly, null when it isn't known (legacy_accounts, while it's there).
export async function oldSitePlan(member: { legacy_user_id?: number | null }): Promise<BillingInterval | null> {
  if (member.legacy_user_id == null) return null;
  const { data } = await createAdminClient().from("legacy_accounts").select("membership_duration, subscription_type").eq("legacy_user_id", member.legacy_user_id).maybeSingle();
  const kind = `${data?.subscription_type ?? ""} ${data?.membership_duration ?? ""}`.toLowerCase();
  return kind.includes("annual") ? "year" : kind.includes("monthly") ? "month" : null;
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const todayCentral = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
// Stripe holds a first charge (trial_end) at most 730 days out.
const MAX_DAYS = 720;

// Sets (or, with date null, takes off) a member's paid-through date. The
// caller checks the staff member is an owner or admin. `date` is the
// Central day (YYYY-MM-DD); it's stored as noon that day, when a held first
// charge would go through. Never touches a subscription: someone already
// billed by their own card is refused.
export async function setPaidThrough(p: { memberId: string; date: string | null; renewsAs: BillingInterval; note: string; staffId: string | null }): Promise<PaidThroughResult> {
  if (p.renewsAs !== "month" && p.renewsAs !== "year") return { ok: false, error: "Pick monthly or yearly." };
  const note = p.note.trim().slice(0, 300) || null;
  const db = createAdminClient();
  const { data: m } = await db
    .from("members")
    .select("id, name, tier, comped, stripe_subscription_id, subscription_status, plus_gift_until, erased_at")
    .eq("id", p.memberId)
    .maybeSingle();
  if (!m || m.erased_at) return { ok: false, error: "Member not found." };
  if (m.comped) return { ok: false, error: "Their Insiders+ is complimentary, so there's nothing paid ahead to record." };
  if (subscriptionLive(m)) return { ok: false, error: "They're already billed by their own card. Their subscription isn't changed here." };
  if (await currentGiftFrom(m.id)) return { ok: false, error: "A gifted year covers them now. A paid-through date would replace it, so sort this one out by hand." };

  let until: string | null = null;
  if (p.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || Number.isNaN(Date.parse(`${p.date}T12:00:00Z`))) return { ok: false, error: "Pick a valid date." };
    if (p.date <= todayCentral()) return { ok: false, error: "Pick a date after today. To end it now, use Take it off." };
    until = centralToIso(p.date, "12:00");
    if (new Date(until).getTime() > Date.now() + MAX_DAYS * 86_400_000) return { ok: false, error: "That's more than about two years out. Stripe can't hold a first charge that long." };
  }

  // Only if it's still what we read, so two changes at once can't cross.
  let update = db.from("members").update(until ? { plus_gift_until: until, tier: "Insiders+" } : { plus_gift_until: null }).eq("id", m.id);
  update = m.plus_gift_until ? update.eq("plus_gift_until", m.plus_gift_until) : update.is("plus_gift_until", null);
  const { data: moved, error } = await update.select("id");
  if (error) return { ok: false, error: "Couldn't save it. Try again." };
  if (!moved?.length) return { ok: false, error: "Their membership changed a moment ago. Reload the page and try again." };

  const { error: logErr } = await db.from("member_paid_through").insert({
    member_id: m.id,
    paid_through: until,
    previous: m.plus_gift_until ?? null,
    renews_as: p.renewsAs,
    note,
    set_by: p.staffId,
  });
  if (logErr) {
    // Put the date back: a change nobody can trace isn't kept.
    await db.from("members").update({ plus_gift_until: m.plus_gift_until ?? null }).eq("id", m.id);
    return { ok: false, error: "Couldn't record the change. Nothing was saved. Try again." };
  }
  return { ok: true, message: until ? `Paid through ${longDate(until)}, renewing ${p.renewsAs === "year" ? "yearly" : "monthly"}.` : "Paid-through date taken off." };
}

// "Your Insiders+ year is already paid", to this one member: how to add a
// card without being charged before their date. Only when staff press the
// button; a few times an hour at most.
export async function sendPaidThroughExplainer(memberId: string): Promise<PaidThroughResult> {
  const db = createAdminClient();
  const { data: m } = await db
    .from("members")
    .select("id, name, email, tier, comped, price_tier, stripe_subscription_id, subscription_status, plus_gift_until, erased_at")
    .eq("id", memberId)
    .maybeSingle();
  if (!m || m.erased_at) return { ok: false, error: "Member not found." };
  if (!m.email) return { ok: false, error: "Add their email first." };
  const rec = prepaidInForce(m, await getPaidThrough(m.id));
  if (!rec?.paidThrough || !giftEndsWithoutRenewal(m)) {
    return { ok: false, error: subscriptionLive(m) ? "Their card is already on, so there's nothing to explain." : "Set a paid-through date first." };
  }
  if (!(await allowAttempt(`paid-through-email:${m.id}`, 3, 3600))) return { ok: false, error: "Already sent a few times this hour." };

  const email = {
    name: m.name,
    paidThrough: rec.paidThrough,
    renewsAs: rec.renewsAs,
    rate: (m.price_tier as MemberPriceTier | null) ?? "adult",
    billingUrl: `${SITE_URL}/account/login?next=${encodeURIComponent("/account/billing")}`,
  };
  const sent = await sendEmail(m.email, paidThroughSubject(email), paidThroughHtml(email), {
    text: paidThroughText(email),
    replyTo: "info@royalecinemajoplin.com",
    tags: [{ name: "type", value: "paid_through_explainer" }],
    idempotencyKey: `paid-through:${m.id}:${Math.floor(Date.now() / 60_000)}`,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, message: `Sent to ${maskEmail(m.email) ?? "their email"}.` };
}
