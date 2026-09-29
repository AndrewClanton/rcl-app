import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { salesTaxRateId } from "@/lib/stripe-tax";
import { siteOrigin } from "@/lib/site-origin";
import { SITE_URL } from "@/lib/site";
import { ANNUAL_PRICE } from "@/lib/membership-rates";
import { giftActive, subscriptionLive } from "@/lib/plus-status";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { giftEndingHtml, giftEndingSubject, giftReceivedHtml, giftReceivedSubject, type GiftEmailData } from "@/lib/email/gift-emails";

// Gift memberships: someone pays once, at the box office, for a year of
// Insiders+ for a friend. It's a one-time Stripe payment (no subscription,
// nothing renews): the buyer's card, the buyer's receipt. The friend's
// member row gets tier Insiders+ and plus_gift_until a year out -- added on
// top of any gift they already have. The daily cron (runGiftMaintenance)
// emails the friend two weeks before the end and turns the perks off after
// it, unless they've signed up to keep going by then.
//
// Gifts are at the adult price: nobody can check the friend's ID when
// someone else is buying.

export const GIFT_MONTHS = 12;
export const GIFT_PRICE = ANNUAL_PRICE.adult;

export type GiftCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

export interface GiftMembership {
  id: string;
  buyer_name: string;
  buyer_email: string;
  message: string | null;
  price: number;
  tax_amount: number;
  status: "pending" | "paid" | "cancelled";
  starts_at: string | null;
  ends_at: string | null;
  paid_at: string | null;
  created_at: string;
  sold_by_staff: { name: string } | null;
}

function addMonths(from: Date, months: number) {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

// Opens Stripe's payment page for a gift to `recipientId`. Staff only (the
// caller checks). The pending gift row is made first so the webhook can
// find it by id; an unpaid page just expires and the row is marked
// cancelled.
export async function createGiftCheckout(p: {
  recipientId: string;
  buyerName: string;
  buyerEmail: string;
  message: string | null;
  soldBy: string | null;
}): Promise<GiftCheckoutResult> {
  const supabase = createAdminClient();
  const { data: friend } = await supabase
    .from("members")
    .select("id, name, email, erased_at, comped, stripe_subscription_id, subscription_status, plus_gift_until")
    .eq("id", p.recipientId)
    .maybeSingle();
  if (!friend || friend.erased_at) return { ok: false, error: "Member not found." };
  if (!friend.email) return { ok: false, error: "Add their email first. It's how they sign in to use the gift, and where we tell them about it." };
  if (friend.comped) return { ok: false, error: "Their Insiders+ is already complimentary, so there's nothing to gift." };
  if (subscriptionLive(friend)) {
    return { ok: false, error: "They already pay for Insiders+ with their own card, so a gift would double up. Sort this one out by hand for now." };
  }

  const { data: gift, error: giftErr } = await supabase
    .from("gift_memberships")
    .insert({
      recipient_member_id: friend.id,
      buyer_name: p.buyerName,
      buyer_email: p.buyerEmail,
      message: p.message,
      months: GIFT_MONTHS,
      price: GIFT_PRICE,
      sold_by: p.soldBy,
    })
    .select("id")
    .single();
  if (giftErr || !gift) return { ok: false, error: "Couldn't start the gift. Try again." };

  try {
    const origin = await siteOrigin();
    const taxRate = await salesTaxRateId();
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      // The buyer's receipt goes to the buyer.
      customer_email: p.buyerEmail,
      line_items: [
        {
          quantity: 1,
          tax_rates: [taxRate],
          price_data: {
            currency: "usd",
            unit_amount: Math.round(GIFT_PRICE * 100),
            product_data: { name: "Insiders+ for a year (gift)", description: `For ${friend.name}. Paid once; doesn't renew.` },
          },
        },
      ],
      payment_intent_data: { description: `Insiders+ gift for ${friend.name}`, metadata: { gift_membership_id: gift.id } },
      metadata: { gift_membership_id: gift.id },
      success_url: `${origin}/membership/gift?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/membership/gift?cancelled=1`,
    });
    await supabase.from("gift_memberships").update({ stripe_checkout_session_id: session.id }).eq("id", gift.id);
    if (!session.url) throw new Error("no url");
    return { ok: true, url: session.url };
  } catch {
    await supabase.from("gift_memberships").delete().eq("id", gift.id).eq("status", "pending");
    return { ok: false, error: "Couldn't open Stripe's payment page. Try again." };
  }
}

// Adds the paid year to the friend. Run by the webhook, and by the thank-you
// page so it shows the new date straight away. Safe to run twice: the
// pending -> paid claim lets exactly one caller through. ok:false means it
// couldn't save, so the webhook answers Stripe with an error and gets it
// again later.
export async function activateGiftFromCheckout(session: Stripe.Checkout.Session): Promise<{ ok: boolean }> {
  const giftId = session.metadata?.gift_membership_id;
  if (!giftId || session.mode !== "payment" || session.payment_status !== "paid") return { ok: true };

  const supabase = createAdminClient();
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const { data: gift, error: claimErr } = await supabase
    .from("gift_memberships")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntentId,
      tax_amount: (session.total_details?.amount_tax ?? 0) / 100,
    })
    .eq("id", giftId)
    .eq("status", "pending")
    .select("id, recipient_member_id, months")
    .maybeSingle();
  if (claimErr) return { ok: false };
  if (!gift) return { ok: true }; // already added

  // Starts today, or where their current gift ends. The update only lands if
  // plus_gift_until is still what we read, so two gifts paid at the same
  // moment can't both start from the same date.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: friend } = await supabase.from("members").select("plus_gift_until").eq("id", gift.recipient_member_id).maybeSingle();
    if (!friend) break;
    const now = new Date();
    const start = giftActive(friend) ? new Date(friend.plus_gift_until as string) : now;
    const end = addMonths(start, gift.months);
    let update = supabase.from("members").update({ tier: "Insiders+", plus_gift_until: end.toISOString() }).eq("id", gift.recipient_member_id);
    update = friend.plus_gift_until ? update.eq("plus_gift_until", friend.plus_gift_until) : update.is("plus_gift_until", null);
    const { data: moved, error } = await update.select("id");
    if (error) break;
    if (moved?.length) {
      await supabase.from("gift_memberships").update({ starts_at: start.toISOString(), ends_at: end.toISOString() }).eq("id", gift.id);
      await sendGiftReceivedEmail(gift.id);
      return { ok: true };
    }
  }
  // Couldn't add the year: put the claim back so the next delivery retries.
  await supabase.from("gift_memberships").update({ status: "pending", paid_at: null }).eq("id", gift.id).eq("status", "paid");
  return { ok: false };
}

async function giftEmailData(giftId: string): Promise<(GiftEmailData & { to: string }) | null> {
  const { data } = await createAdminClient()
    .from("gift_memberships")
    .select("buyer_name, message, ends_at, recipient:members!gift_memberships_recipient_member_id_fkey(name, email, erased_at)")
    .eq("id", giftId)
    .maybeSingle();
  const recipient = data?.recipient as unknown as { name: string; email: string | null; erased_at: string | null } | null;
  if (!data?.ends_at || !recipient?.email || recipient.erased_at) return null;
  return { to: recipient.email, recipientName: recipient.name, buyerName: data.buyer_name, message: data.message, endsLong: longDate(data.ends_at), siteUrl: SITE_URL };
}

// Claims one of a gift's "sent" columns, sends, and releases the claim if
// the send fails, so each email goes at most once. Skipped (unclaimed)
// until email is set up. True when it went out.
async function sendOnce(giftId: string, column: "recipient_emailed_at" | "reminder_sent_at", build: (d: GiftEmailData) => [string, string]): Promise<boolean> {
  if (!emailConfigured()) return false;
  const supabase = createAdminClient();
  const data = await giftEmailData(giftId);
  if (!data) return false;
  const { data: claimed } = await supabase
    .from("gift_memberships")
    .update({ [column]: new Date().toISOString() })
    .eq("id", giftId)
    .is(column, null)
    .select("id");
  if (!claimed?.length) return false;
  const [subject, html] = build(data);
  const sent = await sendEmail(data.to, subject, html, { replyTo: "info@royalecinemajoplin.com" });
  if (!sent.ok) await supabase.from("gift_memberships").update({ [column]: null }).eq("id", giftId);
  return sent.ok;
}

export async function sendGiftReceivedEmail(giftId: string) {
  await sendOnce(giftId, "recipient_emailed_at", (d) => [giftReceivedSubject(d), giftReceivedHtml(d)]);
}

// Daily (from the cron): turn off gifted Insiders+ that has run out, and
// remind friends two weeks ahead. A gift that's been followed by their own
// subscription, a comp, or another gift is left alone.
export async function runGiftMaintenance(): Promise<{ expired: number; reminded: number }> {
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  let expired = 0;
  let reminded = 0;

  const { data: lapsed } = await supabase
    .from("members")
    .select("id, plus_gift_until, comped, stripe_subscription_id, subscription_status")
    .eq("tier", "Insiders+")
    .lt("plus_gift_until", nowIso);
  for (const m of lapsed ?? []) {
    if (m.comped || subscriptionLive(m)) continue;
    // Only if it hasn't been extended since we looked.
    const { data: off } = await supabase
      .from("members")
      .update({ tier: "Insiders" })
      .eq("id", m.id)
      .eq("plus_gift_until", m.plus_gift_until as string)
      .select("id");
    expired += off?.length ?? 0;
  }

  const soon = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const { data: ending } = await supabase
    .from("gift_memberships")
    .select("id, ends_at, recipient:members!gift_memberships_recipient_member_id_fkey(plus_gift_until, comped, stripe_subscription_id, subscription_status)")
    .eq("status", "paid")
    .is("reminder_sent_at", null)
    .gt("ends_at", nowIso)
    .lte("ends_at", soon);
  for (const g of ending ?? []) {
    const m = g.recipient as unknown as { plus_gift_until: string | null; comped: boolean; stripe_subscription_id: string | null; subscription_status: string | null } | null;
    // Not the last gift in the chain, or they're covered after it anyway.
    if (!m || m.comped || subscriptionLive(m) || !m.plus_gift_until || new Date(m.plus_gift_until).getTime() !== new Date(g.ends_at as string).getTime()) continue;
    if (await sendOnce(g.id, "reminder_sent_at", (d) => [giftEndingSubject(d), giftEndingHtml(d)])) reminded++;
  }
  return { expired, reminded };
}

export async function getGiftsForMember(memberId: string): Promise<GiftMembership[]> {
  const { data } = await createAdminClient()
    .from("gift_memberships")
    .select("id, buyer_name, buyer_email, message, price, tax_amount, status, starts_at, ends_at, paid_at, created_at, sold_by_staff:employees!gift_memberships_sold_by_fkey(name)")
    .eq("recipient_member_id", memberId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false });
  return ((data ?? []) as unknown as GiftMembership[]).map((g) => ({ ...g, price: Number(g.price), tax_amount: Number(g.tax_amount) }));
}

// Who gave the friend their current gift, for their own billing page.
export async function currentGiftFrom(memberId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("gift_memberships")
    .select("buyer_name")
    .eq("recipient_member_id", memberId)
    .eq("status", "paid")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.buyer_name ?? null;
}
