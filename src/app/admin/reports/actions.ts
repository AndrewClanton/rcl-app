"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPin } from "@/lib/pin";
import { getStripe } from "@/lib/stripe";

export async function verifyManagerPin(pin: string): Promise<boolean> {
  if (!pin) return false;
  const supabase = createAdminClient();
  const { data: managers } = await supabase.from("employees").select("pin_hash").in("role", ["manager", "admin"]).eq("active", true);
  return (managers ?? []).some((m) => verifyPin(pin, m.pin_hash));
}

// Actually returns the money via Stripe when the order/booking was paid by
// card (stripe_payment_intent_id set) -- flipping the DB status alone,
// which is all this used to do, never touched the customer's card.
// Cash sales have no payment_intent, so there's nothing for Stripe to do;
// the cashier hands back cash and the status flip is the whole story.

export async function refundOrder(orderId: string, pin: string) {
  const ok = await verifyManagerPin(pin);
  if (!ok) throw new Error("Incorrect manager PIN.");
  const supabase = createAdminClient();
  const { data: order, error: fetchErr } = await supabase.from("orders").select("status, stripe_payment_intent_id").eq("id", orderId).single();
  if (fetchErr || !order) throw new Error("Order not found.");
  if (order.status === "refunded") throw new Error("This order was already refunded.");
  if (order.stripe_payment_intent_id) {
    await getStripe().refunds.create({ payment_intent: order.stripe_payment_intent_id });
  }
  const { error } = await supabase.from("orders").update({ status: "refunded" }).eq("id", orderId);
  if (error) throw error;
  revalidatePath("/admin/reports");
  revalidatePath("/admin/members");
}

export async function refundBooking(bookingId: string, pin: string) {
  const ok = await verifyManagerPin(pin);
  if (!ok) throw new Error("Incorrect manager PIN.");
  const supabase = createAdminClient();
  const { data: booking, error: fetchErr } = await supabase
    .from("bookings")
    .select("status, stripe_payment_intent_id")
    .eq("id", bookingId)
    .single();
  if (fetchErr || !booking) throw new Error("Booking not found.");
  if (booking.status === "refunded") throw new Error("This booking was already refunded.");
  if (booking.stripe_payment_intent_id) {
    await getStripe().refunds.create({ payment_intent: booking.stripe_payment_intent_id });
  }
  const { error } = await supabase.from("bookings").update({ status: "refunded" }).eq("id", bookingId);
  if (error) throw error;
  revalidatePath("/admin/members");
}
