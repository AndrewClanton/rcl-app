import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { flagSale } from "@/lib/register-sale-checks";
import { reverseOrderPoints, takeBackPointsShare } from "@/lib/order-refund-points";

// Refunds and disputes made in Stripe's dashboard, not in the app (code
// review N10), from the webhook's charge.refunded and charge.dispute.created.
// Covers any order paid through Stripe: seat orders (metadata kind
// seat_order) and register card sales, both found by the order's
// stripe_payment_intent_id.
//
// Refunds the app makes itself are left to the app: a full refund carries
// metadata source "rcl-app" (admin/reports/actions.ts refundOrder) and a
// partial one kind "partial" with its order_id (refundOrderPart, which saves
// it in order_partial_refunds). Everything here is safe to run twice:
//   - all of it refunded: the order goes from completed to refunded only
//     once (that flip frees the daily coffee and drops it from Reports), and
//     only the call that flips it takes the points back, the same way an
//     in-app refund does (reverseOrderPoints);
//   - part of it: one order_partial_refunds row per Stripe refund
//     (stripe_refund_id is unique), and points come back in proportion only
//     for a row this call saved.
// Each one also lands on Reports -> Register checks for a manager.

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const appMade = (r: Stripe.Refund) => r.metadata?.source === "rcl-app" || (r.metadata?.kind === "partial" && !!r.metadata?.order_id);
const counts = (r: Stripe.Refund) => r.status === "succeeded" || r.status === "pending";

type OrderRow = {
  id: string;
  order_number: number;
  status: string;
  source: string;
  member_id: string | null;
  tax: number;
  tip: number;
  total: number;
};

async function orderForPayment(piId: string): Promise<OrderRow | null> {
  const { data, error } = await createAdminClient()
    .from("orders")
    .select("id, order_number, status, source, member_id, tax, tip, total")
    .eq("stripe_payment_intent_id", piId)
    .in("status", ["completed", "refunded"])
    .order("created_at")
    .limit(1);
  if (error) throw error;
  const o = data?.[0];
  return o ? { ...o, order_number: Number(o.order_number), tax: Number(o.tax), tip: Number(o.tip), total: Number(o.total) } as OrderRow : null;
}

// charge.refunded. Throws when something couldn't be saved, so the webhook
// answers with an error and Stripe sends it again.
export async function syncStripeRefunds(charge: Stripe.Charge): Promise<void> {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;
  const order = await orderForPayment(piId);
  if (!order || order.status === "refunded") return;

  const stripe = getStripe();
  const refunds = (await stripe.refunds.list({ payment_intent: piId, limit: 100 })).data.filter(counts);
  const outside = refunds.filter((r) => !appMade(r));
  if (!outside.length) return; // all made in the app, which does the rest

  const pi = await stripe.paymentIntents.retrieve(piId);
  const received = pi.amount_received || charge.amount;
  const refunded = refunds.reduce((s, r) => s + r.amount, 0);
  const supabase = createAdminClient();

  if (refunded >= received) {
    // All of it back: refunded, once.
    const { data: flipped, error } = await supabase.from("orders").update({ status: "refunded" }).eq("id", order.id).eq("status", "completed").select("id");
    if (error) throw error;
    if (!flipped?.length) return;
    // Movie tickets sold on it give their seats back, as in the app.
    await supabase.from("bookings").update({ status: "refunded" }).eq("order_id", order.id).eq("status", "confirmed");
    await reverseOrderPoints(order.id, null);
    await flagSale("stripe_refund", {
      orderId: order.id,
      orderNumber: order.order_number,
      paymentIntentId: piId,
      details: { amount: round2(refunded / 100), summary: `Order #${order.order_number} was refunded in full in Stripe, not in the app. It's marked refunded here and its points were taken back.` },
    });
    return;
  }

  // Part of it: each refund made in Stripe saved once, points back in
  // proportion to the goods (the tip isn't goods).
  const goods = round2(order.total - order.tip);
  const { data: prior, error: priorErr } = await supabase.from("order_partial_refunds").select("stripe_refund_id, tax_amount").eq("order_id", order.id);
  if (priorErr) throw priorErr;
  const known = new Set((prior ?? []).map((r) => r.stripe_refund_id).filter(Boolean));
  let taxLeft = round2(order.tax - (prior ?? []).reduce((s, r) => s + Number(r.tax_amount), 0));
  for (const r of outside) {
    if (known.has(r.id)) continue;
    const amount = round2(r.amount / 100);
    if (!(amount > 0)) continue;
    const tax = goods > 0 ? Math.max(0, round2(Math.min(amount * (order.tax / goods), taxLeft))) : 0;
    const { data: saved, error } = await supabase
      .from("order_partial_refunds")
      .upsert(
        { order_id: order.id, amount, tax_amount: tax, card_amount: amount, cash_amount: 0, stripe_refund_id: r.id, reason: "Refunded in Stripe", approved_by: null, refunded_by: null },
        { onConflict: "stripe_refund_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    if (!saved?.length) continue; // another delivery saved it
    taxLeft = round2(taxLeft - tax);
    if (order.member_id && goods > 0) {
      await takeBackPointsShare({ orderId: order.id, memberId: order.member_id, share: Math.min(1, amount / goods), note: `${money(amount)} of order #${order.order_number} refunded`, by: null });
    }
    await flagSale("stripe_refund", {
      orderId: order.id,
      orderNumber: order.order_number,
      paymentIntentId: piId,
      details: { amount, summary: `${money(amount)} of order #${order.order_number} was refunded in Stripe, not in the app. It's saved as a partial refund and its points were taken back in proportion.` },
    });
  }
}

// charge.dispute.created: the money is held by Stripe until the dispute is
// decided, so nothing is refunded here. The order is flagged for a manager
// (once per dispute) to answer it in Stripe before its due date.
export async function flagStripeDispute(dispute: Stripe.Dispute): Promise<void> {
  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
  const order = piId ? await orderForPayment(piId) : null;
  const supabase = createAdminClient();
  const { data: already } = await supabase.from("register_sale_flags").select("id").eq("kind", "card_disputed").contains("details", { dispute: dispute.id }).limit(1);
  if (already?.length) return;
  const due = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }) : null;
  const amount = round2(dispute.amount / 100);
  const what = order ? `order #${order.order_number}` : "a card payment with no order here";
  await flagSale("card_disputed", {
    orderId: order?.id ?? null,
    orderNumber: order?.order_number ?? null,
    paymentIntentId: piId,
    details: {
      dispute: dispute.id,
      amount,
      reason: dispute.reason,
      summary: `The card on ${what} was disputed (${money(amount)}, ${String(dispute.reason).replace(/_/g, " ")}). Answer it in Stripe${due ? ` by ${due}` : ""}.`,
    },
  });
}
