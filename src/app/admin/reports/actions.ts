"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkManagerPin, recordApprover } from "@/lib/manager-pin";
import type { ApprovalResult } from "@/lib/pin-rules";
import { getStripe } from "@/lib/stripe";
import { reversePurchasePoints } from "@/lib/points";
import { assertStaff } from "@/lib/auth";

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
  await reversePurchasePoints({ orderId }, staff.employeeId);
  revalidatePath("/admin/reports");
  revalidatePath("/admin/members");
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
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
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}
