import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";
import { tierForPrice } from "@/lib/member-rate";
import { applyPoints } from "@/lib/points";
import { activatePlusFromCheckout } from "@/lib/plus-activate";
import { notifyBoothConfirmed } from "@/lib/booth-notify";

// Stripe requires the exact raw request body (not re-serialized JSON) to
// verify the webhook signature, so this reads request.text() rather than
// request.json().
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const body = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  const supabase = createAdminClient();
  // A save that fails answers Stripe with an error, so Stripe re-sends the
  // event later instead of leaving a paid booking stuck on pending. Every
  // update below is safe to run twice.
  const failed: string[] = [];
  const check = (what: string) => ({ error }: { error: unknown }) => {
    if (error) failed.push(what);
  };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === "subscription") {
      // Insiders+ signup. customer.subscription.updated/deleted below keep
      // the member in step with the subscription after this.
      await activatePlusFromCheckout(session);
    } else {
      const bookingId = session.metadata?.booking_id;
      if (bookingId) {
        await supabase
          .from("bookings")
          .update({
            status: "confirmed",
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
            // The sales tax Stripe added on top of the tickets.
            tax_amount: (session.total_details?.amount_tax ?? 0) / 100,
          })
          .eq("id", bookingId)
          .eq("status", "pending")
          .then(check("booking"));
        // 1 point per $1, like the register. The ledger's unique index keeps
        // a re-delivered webhook from paying out twice.
        const { data: booking } = await supabase.from("bookings").select("member_id, quantity, unit_price, status").eq("id", bookingId).maybeSingle();
        if (booking?.member_id && booking.status === "confirmed") {
          await applyPoints({
            memberId: booking.member_id,
            delta: Number(booking.unit_price) * booking.quantity,
            reason: "purchase",
            bookingId,
            note: `${booking.quantity} ticket${booking.quantity === 1 ? "" : "s"}, bought online`,
          });
        }
      }

      const boothReservationId = session.metadata?.booth_reservation_id;
      if (boothReservationId) {
        await supabase
          .from("booth_reservations")
          .update({
            status: "confirmed",
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
            // The sales tax Stripe added on top of the tickets.
            tax_amount: (session.total_details?.amount_tax ?? 0) / 100,
          })
          .eq("id", boothReservationId)
          .eq("status", "pending")
          .then(check("booth reservation"));
        // Guest confirmation and staff alert, each sent once.
        await notifyBoothConfirmed(boothReservationId);
      }
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = session.metadata?.booking_id;
    if (bookingId) {
      // Only cancel if it never got confirmed -- don't clobber a booking
      // that completed via a race with this expiry event.
      await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId).eq("status", "pending");
    }

    const boothReservationId = session.metadata?.booth_reservation_id;
    if (boothReservationId) {
      await supabase.from("booth_reservations").update({ status: "cancelled" }).eq("id", boothReservationId).eq("status", "pending");
    }
  }

  // Insiders+ subscription lifecycle -- Stripe is the source of truth for
  // whether a member's subscription is actually active, so these events
  // keep the member row's tier/status in sync with what Stripe reports
  // (a failed renewal, a cancellation from the Stripe customer portal,
  // etc.), not just the initial checkout.
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const status = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
    const stillActive = status === "active" || status === "trialing";
    // Rate switches made at the register already set price_tier; this only
    // catches a price changed some other way (e.g. in the Stripe dashboard).
    const price = subscription.items?.data[0]?.price;
    const rate = tierForPrice(price);
    const interval = price?.recurring?.interval === "year" ? "year" : price?.recurring?.interval === "month" ? "month" : null;

    await supabase
      .from("members")
      .update({
        subscription_status: status,
        tier: stillActive ? "Insiders+" : "Insiders",
        monthly_member: stillActive,
        ...(rate ? { price_tier: rate } : {}),
        ...(interval ? { billing_interval: interval } : {}),
      })
      .eq("stripe_customer_id", customerId)
      .then(check("membership"));
  }

  if (failed.length) return NextResponse.json({ error: `Couldn't save: ${failed.join(", ")}` }, { status: 500 });
  return NextResponse.json({ received: true });
}
