import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";
import { tierForPriceId } from "@/lib/member-rate";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === "subscription") {
      // Insiders+ signup: create or upgrade the member row keyed by email.
      // The customer's own row is the source of truth for tier from here
      // on -- customer.subscription.updated/deleted below keep it in sync
      // with the subscription's actual lifecycle.
      const email = session.metadata?.pending_email;
      const name = session.metadata?.pending_name;
      const priceTier = session.metadata?.price_tier;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

      if (email && name && customerId && subscriptionId) {
        const memberFields = {
          tier: "Insiders+" as const,
          price_tier: priceTier ?? null,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          subscription_status: "active",
          monthly_member: true,
        };
        const { data: existing } = await supabase.from("members").select("id").ilike("email", email).maybeSingle();
        if (existing) {
          await supabase.from("members").update(memberFields).eq("id", existing.id);
        } else {
          await supabase.from("members").insert({
            name,
            email,
            phone: session.metadata?.pending_phone || null,
            points: 0,
            ...memberFields,
          });
        }
      }
    } else {
      const bookingId = session.metadata?.booking_id;
      if (bookingId) {
        await supabase
          .from("bookings")
          .update({
            status: "confirmed",
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
          })
          .eq("id", bookingId)
          .eq("status", "pending");
      }

      const boothReservationId = session.metadata?.booth_reservation_id;
      if (boothReservationId) {
        await supabase
          .from("booth_reservations")
          .update({
            status: "confirmed",
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
          })
          .eq("id", boothReservationId)
          .eq("status", "pending");
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
    const rate = tierForPriceId(subscription.items?.data[0]?.price?.id);

    await supabase
      .from("members")
      .update({
        subscription_status: status,
        tier: stillActive ? "Insiders+" : "Insiders",
        monthly_member: stillActive,
        ...(rate ? { price_tier: rate } : {}),
      })
      .eq("stripe_customer_id", customerId);
  }

  return NextResponse.json({ received: true });
}
