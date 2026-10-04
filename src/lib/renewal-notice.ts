import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, shiftDate } from "@/lib/ops/time";
import { tierForPrice } from "@/lib/member-rate";
import { cardName } from "@/lib/card-match";
import { sendEmail } from "@/lib/email/send";
import { renewalNoticeHtml, renewalNoticeSubject, renewalNoticeText, type RenewalNoticeEmail } from "@/lib/email/renewal-notice-email";
import { SITE_URL } from "@/lib/site";

// A week's notice before a yearly Insiders+ renews (Andrew, 10/4: "people
// should get a one week notice ahead of time that they're about to get a
// $153 charge"). Each morning /api/cron/renewal-notices finds every yearly
// Insiders+ subscription whose next charge falls exactly NOTICE_DAYS days
// after today's business day (Chicago, lib/ops/time.ts), and emails the
// date, the amount from Stripe's upcoming invoice (price + tax) and the
// card. The next charge is the end of the period, or the end of the trial
// for a member paid through a date (lib/paid-through.ts), whose first
// charge waits until then. Anything canceled or set to cancel is skipped.
//
// It's a billing notice, so it goes like a receipt (sendEmail): the
// marketing Sending switch and opt-outs don't stop it. Each notice is a
// row in renewal_notices (migration 20261004020000), claimed before the
// email goes, so a renewal is never noticed twice however often this runs.

export const NOTICE_DAYS = 7;

const TZ = "America/Chicago";
// The Chicago calendar date of a Stripe time ("2027-03-13").
const chicagoDate = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: TZ });

// The yearly Insiders+ price: by its lookup key (lib/member-rate.ts), or
// the metadata the app puts on the prices it makes.
function yearlyPlus(price: Stripe.Price): boolean {
  return price.recurring?.interval === "year" && (tierForPrice(price) !== null || price.metadata?.rcl === "insiders_plus");
}

// When a subscription next charges, as a Stripe time, if it's a yearly
// Insiders+ one that will renew: the end of the trial while trialing (a
// paid-through member), otherwise the end of the current period. Null for
// anything else, including one canceled or set to cancel.
export function nextYearlyCharge(sub: Stripe.Subscription): number | null {
  if (sub.status !== "active" && sub.status !== "trialing") return null;
  if (sub.cancel_at_period_end || sub.cancel_at || sub.pause_collection) return null;
  const item = sub.items.data[0];
  if (!item || !yearlyPlus(item.price)) return null;
  const end = sub.status === "trialing" && sub.trial_end ? sub.trial_end : item.current_period_end;
  return end || null;
}

// The charge time when it falls exactly NOTICE_DAYS out from today's
// business day; null otherwise.
export function noticeDueFor(sub: Stripe.Subscription, now = new Date()): number | null {
  const at = nextYearlyCharge(sub);
  return at && chicagoDate(at) === shiftDate(businessDay(now).date, NOTICE_DAYS) ? at : null;
}

export interface NoticeMember {
  id: string;
  name: string | null;
  email: string;
}

type Sender = (to: string, subject: string, html: string, opts: Parameters<typeof sendEmail>[3]) => ReturnType<typeof sendEmail>;

export interface RenewalNoticeSummary {
  checked: number;
  due: number;
  sent: number;
  already: number;
  skipped: { subscription: string; why: string }[];
  failed: { subscription: string; error: string }[];
}

const customerId = (sub: Stripe.Subscription) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id);

// The member a subscription bills: by the subscription, else by the
// Stripe customer. Never an erased account or one with no email.
async function memberForSubscription(sub: Stripe.Subscription): Promise<NoticeMember | null> {
  const { data } = await createAdminClient()
    .from("members")
    .select("id, name, email, erased_at, stripe_subscription_id")
    .or(`stripe_subscription_id.eq.${sub.id},stripe_customer_id.eq.${customerId(sub)}`)
    .limit(5);
  const rows = (data ?? []).filter((m) => !m.erased_at && m.email);
  const m = rows.find((r) => r.stripe_subscription_id === sub.id) ?? rows[0];
  return m ? { id: m.id, name: m.name, email: m.email } : null;
}

// "Visa ending 4242": the subscription's card, else the customer's default.
async function cardFor(stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  const label = (pm: string | Stripe.PaymentMethod | null | undefined) =>
    pm && typeof pm !== "string" && pm.card ? `${cardName({ brand: pm.card.brand, wallet: null })} ending ${pm.card.last4}` : null;
  const full = await stripe.subscriptions.retrieve(sub.id, { expand: ["default_payment_method"] });
  const own = label(full.default_payment_method);
  if (own) return own;
  const customer = await stripe.customers.retrieve(customerId(sub), { expand: ["invoice_settings.default_payment_method"] });
  return customer.deleted ? null : label(customer.invoice_settings?.default_payment_method);
}

// The email for one renewal, with the real figures from Stripe's upcoming
// invoice.
async function noticeFor(stripe: Stripe, sub: Stripe.Subscription, member: NoticeMember, chargeAt: number): Promise<RenewalNoticeEmail> {
  const preview = await stripe.invoices.createPreview({ customer: customerId(sub), subscription: sub.id });
  const total = preview.total;
  const price = preview.total_excluding_tax ?? preview.subtotal;
  const card = await cardFor(stripe, sub).catch(() => null);
  return {
    name: member.name,
    chargeAt: new Date(chargeAt * 1000).toISOString(),
    priceCents: price,
    taxCents: Math.max(0, total - price),
    totalCents: total,
    card,
    billingUrl: `${SITE_URL}/account/login?next=${encodeURIComponent("/account/billing")}`,
  };
}

export async function runRenewalNotices(
  o: {
    now?: Date;
    deadline?: number;
    // For the check script: a stub sender, its own member lookup, and only
    // its own test subscriptions.
    send?: Sender;
    memberFor?: (sub: Stripe.Subscription) => Promise<NoticeMember | null>;
    only?: (sub: Stripe.Subscription) => boolean;
    stripe?: Stripe;
  } = {},
): Promise<RenewalNoticeSummary> {
  const now = o.now ?? new Date();
  const stripe = o.stripe ?? getStripe();
  const send = o.send ?? sendEmail;
  const memberFor = o.memberFor ?? memberForSubscription;
  const db = createAdminClient();
  const summary: RenewalNoticeSummary = { checked: 0, due: 0, sent: 0, already: 0, skipped: [], failed: [] };

  const due: { sub: Stripe.Subscription; at: number }[] = [];
  for (const status of ["active", "trialing"] as const) {
    for await (const sub of stripe.subscriptions.list({ status, limit: 100 })) {
      if (o.only && !o.only(sub)) continue;
      summary.checked++;
      const at = noticeDueFor(sub, now);
      if (at) due.push({ sub, at });
    }
  }
  summary.due = due.length;

  for (const { sub, at } of due) {
    if (o.deadline && Date.now() > o.deadline) break;
    const member = await memberFor(sub).catch(() => null);
    if (!member) {
      summary.skipped.push({ subscription: sub.id, why: "No member account with an email for it." });
      continue;
    }
    const chargeDate = chicagoDate(at);
    // Claimed first: the unique key means a rerun (or two runs at once)
    // never emails the same renewal again.
    const { data: claim, error: claimError } = await db
      .from("renewal_notices")
      .insert({ member_id: member.id, stripe_subscription_id: sub.id, charge_at: new Date(at * 1000).toISOString(), charge_date: chargeDate })
      .select("id")
      .single();
    if (!claim) {
      if (claimError?.code === "23505") summary.already++;
      else summary.failed.push({ subscription: sub.id, error: claimError?.message ?? "Couldn't record the notice." });
      continue;
    }
    let result: Awaited<ReturnType<Sender>>;
    try {
      const email = await noticeFor(stripe, sub, member, at);
      result = await send(member.email, renewalNoticeSubject(email), renewalNoticeHtml(email), {
        text: renewalNoticeText(email),
        replyTo: "info@royalecinemajoplin.com",
        tags: [{ name: "type", value: "renewal_notice" }],
        // Resend drops a repeat within 24 hours, in case the row below
        // didn't save after the email went.
        idempotencyKey: `renewal-notice:${sub.id}:${chargeDate}`,
      });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : "Couldn't build the notice." };
    }
    if (!result.ok) {
      // Give the claim back, so the next run today tries again.
      await db.from("renewal_notices").delete().eq("id", claim.id);
      summary.failed.push({ subscription: sub.id, error: result.error });
      continue;
    }
    await db.from("renewal_notices").update({ sent_at: new Date().toISOString(), resend_id: result.id }).eq("id", claim.id);
    summary.sent++;
  }
  return summary;
}

// The member page's "Renewal notice sent <date>": the notice for their next
// renewal still to come, if one went.
export async function getUpcomingRenewalNotice(memberId: string): Promise<{ sentAt: string; chargeAt: string } | null> {
  const { data } = await createAdminClient()
    .from("renewal_notices")
    .select("sent_at, charge_at")
    .eq("member_id", memberId)
    .not("sent_at", "is", null)
    .gt("charge_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("charge_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.sent_at ? { sentAt: data.sent_at, chargeAt: data.charge_at } : null;
}
