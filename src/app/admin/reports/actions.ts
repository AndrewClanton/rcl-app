"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkManagerPin, recordApprover } from "@/lib/manager-pin";
import type { Approval, ApprovalResult } from "@/lib/pin-rules";
import { getStripe } from "@/lib/stripe";
import { applyPoints, reversePurchasePoints } from "@/lib/points";
import { assertStaff } from "@/lib/auth";
import { planPartialRefund } from "@/lib/data/refund-plan";

// A plain yes/no, kept for any caller that only needs that. Goes through
// the same guess limit and log as the refunds below (src/lib/manager-pin.ts).
export async function verifyManagerPin(pin: string): Promise<boolean> {
  const staff = await assertStaff();
  return (await checkManagerPin(pin, "approval", staff.employeeId)).ok;
}

// Actually returns the money via Stripe when the order/booking was paid by
// card (stripe_payment_intent_id set) -- flipping the DB status alone,
// which is all this used to do, never touched the customer's card.
// Cash sales have no payment_intent, so there's nothing for Stripe to do;
// the cashier hands back cash and the status flip is the whole story.
//
// Both return the reason on failure (a wrong PIN, the lock), since a
// thrown message is hidden in production, and on success which manager's
// PIN approved it, for "Approved by Sam."

function stripeProblem(e: unknown): string {
  const message = e instanceof Error ? e.message : null;
  return `The card refund didn't go through${message ? ` (Stripe: ${message})` : ""}. Nothing was changed.`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Takes back the points a refunded order earned (and returns any it
// redeemed). reverse_purchase_points does that in one go, but only once per
// order: after a partial refund has already taken some back, it would do
// nothing. So once an order has a partial refund, the rest is worked out
// here from the order's points history instead.
async function reverseOrderPoints(orderId: string, by: string) {
  const { data: rows, error } = await createAdminClient().from("points_ledger").select("member_id, delta, reason").eq("order_id", orderId);
  const earlier = (rows ?? []).filter((r) => r.reason === "refund");
  if (error || earlier.length === 0) return reversePurchasePoints({ orderId }, by);
  const own = (rows ?? []).filter((r) => r.reason === "purchase" || r.reason === "redeem");
  const memberId = own[0]?.member_id as string | undefined;
  const net = own.reduce((s, r) => s + Number(r.delta), 0);
  const alreadyBack = earlier.reduce((s, r) => s + Number(r.delta), 0);
  const rest = round2(-net - alreadyBack);
  if (memberId && rest !== 0) await applyPoints({ memberId, delta: rest, reason: "refund", orderId, note: "Rest of the purchase refunded", by });
}

export async function refundOrder(orderId: string, pin: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "refund-order", staff.employeeId, orderId);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  const { data: order, error: fetchErr } = await supabase.from("orders").select("status, stripe_payment_intent_id").eq("id", orderId).single();
  if (fetchErr || !order) return { ok: false, error: "Order not found." };
  if (order.status === "refunded") return { ok: false, error: "This order was already refunded." };
  if (order.stripe_payment_intent_id) {
    try {
      // No amount: Stripe refunds whatever is left on the payment, so an
      // earlier partial refund isn't refunded twice.
      await getStripe().refunds.create({ payment_intent: order.stripe_payment_intent_id });
    } catch (e) {
      return { ok: false, error: stripeProblem(e) };
    }
  }
  const { error } = await supabase.from("orders").update({ status: "refunded" }).eq("id", orderId);
  if (error) throw error;
  await recordApprover("orders", orderId, approval.approverId);
  // Movie tickets sold on this order give their seats back.
  await supabase.from("bookings").update({ status: "refunded" }).eq("order_id", orderId).eq("status", "confirmed");
  await reverseOrderPoints(orderId, staff.employeeId);
  revalidatePath("/admin/reports");
  revalidatePath("/admin/members");
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

// ---------- partial refunds (code review B2) ----------
// Part of a completed order back: a wrong drink, a dish sent back. The
// manager enters how much the customer gets back, tax included; the sales
// tax inside it is the order's tax in proportion. Card money goes back
// through Stripe (the same way a full refund does); cash is handed back
// from the drawer. Each one is a row in order_partial_refunds (migration
// 20260929213100), which the day report and the sales tax report take off
// the day the order was sold. Points come back off the member in the same
// proportion; a reward they redeemed stays used until a full refund.
//
// Limits: up to what was paid in cash or on a card for the goods, less
// earlier partial refunds. Tips and paper vouchers aren't refunded in part
// (a full refund covers everything). Movie tickets on the order keep their
// seats; refund the whole order to give a seat back.

export type PartialRefundResult = ({ ok: true; message: string } & Approval) | { ok: false; error: string };

export async function refundOrderPart(orderId: string, amountIn: number, reasonIn: string, pin: string): Promise<PartialRefundResult> {
  const staff = await assertStaff();
  const amount = round2(Number(amountIn));
  if (!(amount > 0)) return { ok: false, error: "Enter how much to give back, like 6.50." };
  const reason = String(reasonIn ?? "").trim().slice(0, 200) || null;

  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, status, source, member_id, tax, tip, total, payment_cash_amount, payment_card_amount, stripe_payment_intent_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "refunded") return { ok: false, error: "This order was already refunded in full." };
  if (order.status !== "completed") return { ok: false, error: "Only a paid, completed order can be refunded." };

  const { data: prior, error: priorErr } = await supabase.from("order_partial_refunds").select("amount, tax_amount, card_amount, cash_amount").eq("order_id", orderId);
  if (priorErr) {
    return { ok: false, error: "Partial refunds need a database update first (migration 20260929213100_order_partial_refunds.sql). Nothing was refunded. A full refund still works." };
  }
  const sum = (key: "amount" | "tax_amount" | "card_amount") => round2((prior ?? []).reduce((s, r) => s + Number(r[key]), 0));
  const earlier = { amount: sum("amount"), tax: sum("tax_amount"), card: sum("card_amount") };
  const refundable = {
    source: order.source as string,
    tax: Number(order.tax),
    tip: Number(order.tip),
    total: Number(order.total),
    cash: Number(order.payment_cash_amount ?? 0),
    card: Number(order.payment_card_amount ?? 0),
  };
  const plan = planPartialRefund(refundable, earlier, amount);
  if (!plan.ok) {
    if (plan.most <= 0) return { ok: false, error: "There's nothing left to refund in part on this order. Use a full refund for the rest (tip included)." };
    return {
      ok: false,
      error: `The most that can go back in part is ${money(plan.most)}${earlier.amount > 0 ? ` (${money(earlier.amount)} was already refunded)` : ""}. To give back everything, tip included, use a full refund.`,
    };
  }

  const approval = await checkManagerPin(pin, "refund-order-part", staff.employeeId, orderId);
  if (!approval.ok) return approval;

  const { toCard, toCash, tax: taxShare } = plan;

  let stripeRefundId: string | null = null;
  if (toCard > 0 && order.stripe_payment_intent_id) {
    try {
      // The idempotency key makes a retry of this same refund (say the save
      // below failed) return the refund already made instead of a second one.
      const refund = await getStripe().refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id,
          amount: Math.round(toCard * 100),
          reason: "requested_by_customer",
          metadata: { order_id: orderId, order_number: String(order.order_number), kind: "partial" },
        },
        { idempotencyKey: `rcl-part-refund-${orderId}-${(prior ?? []).length}-${Math.round(toCard * 100)}` },
      );
      stripeRefundId = refund.id;
    } catch (e) {
      return { ok: false, error: stripeProblem(e) };
    }
  }

  const { error: saveErr } = await supabase.from("order_partial_refunds").insert({
    order_id: orderId,
    amount,
    tax_amount: taxShare,
    card_amount: toCard,
    cash_amount: toCash,
    stripe_refund_id: stripeRefundId,
    reason,
    approved_by: approval.approverId,
    refunded_by: staff.employeeId,
  });
  if (saveErr) {
    console.error("partial refund not saved", orderId, stripeRefundId, saveErr.message);
    return {
      ok: false,
      error: stripeRefundId
        ? `${money(toCard)} went back to the card, but it wasn't saved here. Press Refund again with the same amount to save it: the card won't be refunded twice.`
        : "Couldn't save the refund. Nothing was refunded. Try again.",
    };
  }

  // Points back in proportion to the part refunded (earned on the whole order).
  if (order.member_id && plan.share > 0) {
    const { data: rows } = await supabase.from("points_ledger").select("delta, reason").eq("order_id", orderId);
    const earned = (rows ?? []).filter((r) => r.reason === "purchase").reduce((s, r) => s + Number(r.delta), 0);
    const alreadyBack = (rows ?? []).filter((r) => r.reason === "refund").reduce((s, r) => s + Number(r.delta), 0); // negative
    const takeBack = round2(Math.min(earned * plan.share, earned + alreadyBack));
    if (takeBack > 0) {
      await applyPoints({ memberId: order.member_id, delta: -takeBack, reason: "refund", orderId, note: `${money(amount)} of order #${order.order_number} refunded`, by: staff.employeeId });
    }
  }

  revalidatePath("/admin/reports");
  revalidatePath("/admin/members");

  const how: string[] = [];
  if (toCard > 0) how.push(stripeRefundId ? `${money(toCard)} is going back to their card (it shows in 5 to 10 days)` : `give ${money(toCard)} back on the card machine the sale was run on (it wasn't paid on the register's reader, so it can't go back automatically)`);
  if (toCash > 0) how.push(`hand back ${money(toCash)} in cash from the drawer`);
  const message = `Refunded ${money(amount)} of order #${order.order_number}: ${how.join(", and ")}.`;
  return { ok: true, message, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

export async function refundBooking(bookingId: string, pin: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "refund-booking", staff.employeeId, bookingId);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select("status, stripe_payment_intent_id")
    .eq("id", bookingId)
    .single();
  if (fetchErr || !booking) return { ok: false, error: "Booking not found." };
  if (booking.status === "refunded") return { ok: false, error: "This booking was already refunded." };
  if (booking.stripe_payment_intent_id) {
    try {
      await getStripe().refunds.create({ payment_intent: booking.stripe_payment_intent_id });
    } catch (e) {
      return { ok: false, error: stripeProblem(e) };
    }
  }
  const { error } = await supabase.from("bookings").update({ status: "refunded" }).eq("id", bookingId);
  if (error) throw error;
  await recordApprover("bookings", bookingId, approval.approverId);
  await reversePurchasePoints({ bookingId }, staff.employeeId);
  revalidatePath("/admin/members");
  revalidatePath("/admin/screenings");
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}
