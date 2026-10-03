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
import { recordCheckoutPayment, recordGiftPayment, recordSubscriptionEnd } from "@/lib/membership-payments/sync";
import { exactEmail } from "@/lib/email-match";

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
      // A failed save answers Stripe 500, so Stripe sends the event again
      // (activatePlusFromCheckout is safe to repeat).
      const plus = await activatePlusFromCheckout(session);
      if (!plus.ok) failed.push("membership signup");
      // The subscription's card is theirs: linked, so paying with it at the
      // bar earns their points even when nobody attaches them. Never fails
      // the webhook (and does nothing without a member).
      await linkPlusCard(plus.memberId, session);
      // Its first charge, into Reports right away (after the answer to
      // Stripe; best effort: the Reports sync reads it anyway, and it's
      // only counted once).
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
        const { data: booking, error: bookingErr } = await supabase
          .from("bookings")
          .select("member_id, customer_email, quantity, unit_price, status")
          .eq("id", bookingId)
          .maybeSingle();
        if (bookingErr) failed.push("booking points");
        // The Insiders+ member's own free seat, a $0 booking of its own
        // that came with these paid seats. No payment on it, so a refund
        // is always made from the paid booking. Confirmed only beside
        // confirmed paid seats: a retry after the paid booking was refunded
        // mustn't bring it back (the database lets it go with them).
        if (booking?.status === "confirmed") {
          await supabase.from("bookings").update({ status: "confirmed" }).eq("paid_booking_id", bookingId).eq("status", "pending").then(check("free seat"));
        }
        let memberId: string | null = booking?.member_id ?? null;
        // Bought signed out: it goes to the member with that email now that
        // it's paid (so they earn the points), never before.
        if (booking?.status === "confirmed" && !memberId && booking.customer_email) {
          const found = await memberForEmail(supabase, booking.customer_email);
          if (!found.ok) failed.push("booking member");
          else if (found.id) {
            memberId = found.id;
            await supabase.from("bookings").update({ member_id: found.id }).eq("id", bookingId).is("member_id", null).then(check("booking member"));
          }
        }
        // 1 point per $1, like the register. The ledger's unique index keeps
        // a re-delivered webhook from paying out twice.
        if (memberId && booking?.status === "confirmed") {
          await applyPoints({
            memberId,
            delta: Number(booking.unit_price) * booking.quantity,
            reason: "purchase",
            bookingId,
            note: `${booking.quantity} ticket${booking.quantity === 1 ? "" : "s"}, bought online`,
          });
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
        // Reserved signed out: into the history of the member with that
        // email, now that it's paid.
        const { data: reservation, error: reservationErr } = await supabase
          .from("booth_reservations")
          .select("member_id, customer_email, status")
          .eq("id", boothReservationId)
          .maybeSingle();
        if (reservationErr) failed.push("booth reservation member");
        if (reservation?.status === "confirmed" && !reservation.member_id && reservation.customer_email) {
          const found = await memberForEmail(supabase, reservation.customer_email);
          if (!found.ok) failed.push("booth reservation member");
          else if (found.id) {
            await supabase
              .from("booth_reservations")
              .update({ member_id: found.id })
              .eq("id", boothReservationId)
              .is("member_id", null)
              .then(check("booth reservation member"));
          }
        }
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
    }
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = session.metadata?.booking_id;
    if (bookingId) {
      // Only cancel if it never got confirmed -- don't clobber a booking
      // that completed via a race with this expiry event. Its free
      // Insiders+ seat, if it had one, is let go with it.
      await supabase.from("bookings").update({ status: "cancelled" }).eq("id", bookingId).eq("status", "pending").then(check("booking"));
      await supabase.from("bookings").update({ status: "cancelled" }).eq("paid_booking_id", bookingId).eq("status", "pending").then(check("free seat"));
    }

    const boothReservationId = session.metadata?.booth_reservation_id;
    if (boothReservationId) {
      await supabase.from("booth_reservations").update({ status: "cancelled" }).eq("id", boothReservationId).eq("status", "pending").then(check("booth reservation"));
    }

    const giftId = session.metadata?.gift_membership_id;
    if (giftId) {
      await supabase.from("gift_memberships").update({ status: "cancelled" }).eq("id", giftId).eq("status", "pending").then(check("gift membership"));
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

// The member account with this email, if there is one. ok: false when the
// lookup itself failed (so Stripe should try again).
async function memberForEmail(supabase: ReturnType<typeof createAdminClient>, email: string): Promise<{ ok: boolean; id: string | null }> {
  const { data, error } = await supabase.from("members").select("id").ilike("email", exactEmail(email)).is("erased_at", null).maybeSingle();
  if (error) return { ok: false, id: null };
  return { ok: true, id: (data?.id as string | undefined) ?? null };
}
