import { NextResponse, after, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";
import { tierForPrice } from "@/lib/member-rate";
import { applyPoints } from "@/lib/points";
import { activatePlusFromCheckout } from "@/lib/plus-activate";
import { notifyBoothConfirmed } from "@/lib/booth-notify";
import { activateGiftFromCheckout } from "@/lib/gift-membership";
import { linkPlusCard, settleBookingCard } from "@/lib/member-cards";
import { invoicePaidFromCheckout } from "@/lib/org-invoice-server";
import { recordCheckoutPayment, recordGiftPayment, recordSubscriptionEnd } from "@/lib/membership-payments/sync";
import { closeIfDeclined, finishSeatCheckout } from "@/lib/seat-ordering-server";
import { flagStripeDispute, syncStripeRefunds } from "@/lib/stripe-refunds";
import { awardEventBadges } from "@/lib/badges/events";

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

  // A seat order paid on a phone (lib/seat-ordering-server.ts): the phone
  // usually saves it itself; this catches one whose phone never got back.
  // Needs payment_intent.succeeded on the webhook's events.
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.kind === "seat_order" && pi.metadata.seat_checkout_id) {
      try {
        const r = await finishSeatCheckout(pi.metadata.seat_checkout_id);
        if (!r.ok && !r.pending) console.error("seat order webhook:", pi.id, r.error);
      } catch (e) {
        console.error("seat order webhook failed", pi.id, e);
        failed.push("seat order");
      }
    }
  }

  // A seat order's card declined: after MAX_DECLINES its payment is called
  // off, so one payment can't be used to try card after card (card testing).
  // Needs payment_intent.payment_failed on the webhook's events. Best
  // effort: never fails the webhook.
  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.kind === "seat_order") await closeIfDeclined(pi.id).catch((e) => console.error("seat order webhook: decline not checked", pi.id, e));
  }

  // A refund or dispute made in Stripe's dashboard on a seat order or a
  // register card sale (lib/stripe-refunds.ts): the order marked refunded
  // (or the part saved) and its points taken back, or a dispute flagged for
  // a manager. Refunds made in the app are left to the app. Needs
  // charge.refunded and charge.dispute.created on the webhook's events.
  if (event.type === "charge.refunded") {
    try {
      await syncStripeRefunds(event.data.object as Stripe.Charge);
    } catch (e) {
      console.error("refund webhook failed", (event.data.object as Stripe.Charge).id, e);
      failed.push("refund");
    }
  }
  if (event.type === "charge.dispute.created") {
    try {
      await flagStripeDispute(event.data.object as Stripe.Dispute);
    } catch (e) {
      console.error("dispute webhook failed", (event.data.object as Stripe.Dispute).id, e);
      failed.push("dispute");
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === "subscription") {
      // Insiders+ signup. customer.subscription.updated/deleted below keep
      // the member in step with the subscription after this.
      const plusMemberId = await activatePlusFromCheckout(session);
      // The subscription's card is theirs: linked, so paying with it at the
      // bar earns their points even when nobody attaches them. Never fails
      // the webhook.
      await linkPlusCard(plusMemberId, session);
      // Its first charge, into Reports right away (after the answer to
      // Stripe; best effort: the Reports sync reads it anyway).
      after(() => recordCheckoutPayment(session));
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
          // A ticket for a showing today: its event badges (lib/badges/events.ts).
          const memberId = booking.member_id as string;
          after(() => awardEventBadges({ memberIds: [memberId] }).then(() => undefined, (e) => console.error("event badges online", e)));
        }
        // The card that paid: linked to the member if they were signed in,
        // or, with nobody on the booking, finding the member it belongs to
        // (lib/member-cards.ts). Never fails the webhook.
        await settleBookingCard({
          bookingId,
          paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
          signedInMemberId: session.metadata?.signed_in_member,
        });
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

      // A year of Insiders+ someone bought for a friend at the box office.
      if (session.metadata?.gift_membership_id) {
        const giftId = session.metadata.gift_membership_id;
        const gift = await activateGiftFromCheckout(session);
        if (!gift.ok) failed.push("gift membership");
        else after(() => recordGiftPayment(giftId));
      }

      // An organization's invoice paid through its pay-by-card link.
      if (session.payment_link && !(await invoicePaidFromCheckout(session))) failed.push("organization invoice");
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

    const giftId = session.metadata?.gift_membership_id;
    if (giftId) {
      await supabase.from("gift_memberships").update({ status: "cancelled" }).eq("id", giftId).eq("status", "pending");
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
    // A gifted year still running keeps the perks on after their own
    // subscription stops.
    if (!stillActive) {
      await supabase
        .from("members")
        .update({ tier: "Insiders+" })
        .eq("stripe_customer_id", customerId)
        .gt("plus_gift_until", new Date().toISOString())
        .then(check("membership gift"));
    }
    // "Cancelled" on Reports -> Members, Week and Month (best effort, after
    // the answer; the Reports sync reads these events too).
    if (event.type === "customer.subscription.deleted") after(() => recordSubscriptionEnd(subscription));
  }

  if (failed.length) return NextResponse.json({ error: `Couldn't save: ${failed.join(", ")}` }, { status: 500 });
  return NextResponse.json({ received: true });
}
