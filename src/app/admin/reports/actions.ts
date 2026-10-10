"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkManagerPin, checkOtherOwnerPin, recordApprover } from "@/lib/manager-pin";
import type { Approval, ApprovalResult } from "@/lib/pin-rules";
import { getStripe } from "@/lib/stripe";
import { applyPoints, reversePurchasePoints } from "@/lib/points";
import { reverseOrderPoints } from "@/lib/order-refund-points";
import { assertStaff } from "@/lib/auth";
import { planPartialRefund } from "@/lib/data/refund-plan";
import { refundOrderGiftCards } from "@/lib/gift-cards-server";

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

// reason: why, for an order on an owner's tab (required there; see
// takeOffOwnerTab).
export async function refundOrder(orderId: string, pin: string, reason?: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  // "*": the owner tab's columns come with its migration.
  const { data: kind } = await createAdminClient().from("orders").select("*").eq("id", orderId).maybeSingle();
  if (kind?.payment_method === "owner_tab") return takeOffOwnerTab(orderId, kind.owner_tab_employee_id ?? null, pin, reason, staff.employeeId);
  const approval = await checkManagerPin(pin, "refund-order", staff.employeeId, orderId);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  const { data: order, error: fetchErr } = await supabase.from("orders").select("status, stripe_payment_intent_id").eq("id", orderId).single();
  if (fetchErr || !order) return { ok: false, error: "Order not found." };
  if (order.status === "refunded") return { ok: false, error: "This order was already refunded." };
  // A gift card this order sold that's been spent can't be taken back, so
  // the order isn't refunded whole (that would pay back money already
  // spent). Before the gift cards migration there are none to find.
  const { data: spentCards } = await supabase.from("gift_cards").select("code, initial_amount, balance").eq("sold_order_id", orderId).eq("status", "active");
  const spent = (spentCards ?? []).filter((c) => Number(c.balance) < Number(c.initial_amount));
  if (spent.length) {
    const c = spent[0];
    return {
      ok: false,
      error: `Gift card ${c.code} from this order has been used (${money(Number(c.initial_amount) - Number(c.balance))} spent), so this order can't be refunded in full. Do a partial refund instead: enter the amount the customer gets back and tap Give back (not Refund all of it).`,
    };
  }
  if (order.stripe_payment_intent_id) {
    try {
      // No amount: Stripe refunds whatever is left on the payment, so an
      // earlier partial refund isn't refunded twice.
      // Tagged as the app's, so the webhook's charge.refunded leaves it to
      // this (lib/stripe-refunds.ts).
      await getStripe().refunds.create({ payment_intent: order.stripe_payment_intent_id, metadata: { source: "rcl-app", order_id: orderId, kind: "full" } });
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
  // What gift cards paid goes back on them; cards this order sold are voided.
  await refundOrderGiftCards(orderId, staff.employeeId);
  revalidatePath("/admin/reports");
  revalidatePath("/admin/members");
  revalidatePath("/admin/gift-cards");
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

// An order on an owner's monthly tab (the owner rate: lib/register-totals.ts)
// took no money, so "refunding" it takes it off the tab: off that month's
// statement and out of Reports, with no money going anywhere. Only another
// owner's PIN does it (checkOtherOwnerPin), never the tab's own owner's or a
// manager's, and only with a reason, which the statement shows ("taken off
// by Nathan: rang the wrong tab").
async function takeOffOwnerTab(orderId: string, tabOwnerId: string | null, pin: string, reasonIn: string | undefined, requestedBy: string): Promise<ApprovalResult> {
  const reason = String(reasonIn ?? "").trim().slice(0, 200);
  if (reason.length < 3) return { ok: false, error: "Say why it's coming off the owner tab." };
  const approval = await checkOtherOwnerPin(pin, tabOwnerId, "owner-tab-off", requestedBy, orderId);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "refunded", refund_approved_by: approval.approverId, owner_tab_removed_by: approval.approverId, owner_tab_removed_reason: reason, owner_tab_removed_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("status", "completed")
    .select("id");
  if (error) return { ok: false, error: "Couldn't take it off the tab. Try again." };
  if (!data?.length) return { ok: false, error: "That order isn't on the tab anymore (it may have been taken off already)." };
  // Movie tickets on it give their seats back. No points: an owner-tab order earns none.
  await supabase.from("bookings").update({ status: "refunded" }).eq("order_id", orderId).eq("status", "confirmed");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/owner-rate");
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: false };
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
  const { data: tab } = await supabase.from("orders").select("payment_method").eq("id", orderId).maybeSingle();
  if (tab?.payment_method === "owner_tab") return { ok: false, error: "An owner-tab order comes off the tab whole: use Refund all of it, with another owner's PIN." };

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

  // Points back in proportion to the part refunded (earned on the whole
  // order), from the member on it now. (Points given for the order after a
  // card match was undone are an adjustment tied to it: lib/member-cards.ts.)
  if (order.member_id && plan.share > 0) {
    const { data: rows } = await supabase.from("points_ledger").select("delta, reason").eq("order_id", orderId).eq("member_id", order.member_id);
    const earned = (rows ?? []).filter((r) => r.reason === "purchase" || (r.reason === "adjustment" && Number(r.delta) > 0)).reduce((s, r) => s + Number(r.delta), 0);
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
