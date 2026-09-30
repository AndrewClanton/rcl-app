"use server";

import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { salesTaxRateId } from "@/lib/stripe-tax";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks } from "@/lib/plus-status";
import { sameEmail } from "@/lib/email-match";
import { memberHasBookingFor } from "@/lib/data/screening-detail";
import { allowFromConnection, checkHuman, TOO_MANY_FROM_CONNECTION } from "@/lib/public-form-guard";

// Vercel/Next set these on the incoming request; falls back to localhost
// for `next dev`. Avoids needing a hardcoded NEXT_PUBLIC_SITE_URL that
// would have to differ between local/preview/production.
// Next.js redacts a *thrown* Server Action error's message in production
// builds (only a generic "Minified React error..." reaches the client --
// the real text only ever shows in dev). Expected, user-actionable errors
// are modeled as return values instead, per Next's own guidance, so the
// real message reaches the client in every environment. Genuine
// unexpected failures (a DB/Stripe error) are left as throws below.
export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

const MAX_TICKETS_PER_ORDER = 10;

export async function startCheckout(fields: {
  screeningId: string;
  quantity: number;
  customerName: string;
  customerEmail: string;
  // The page's bot check (lib/public-form-guard.ts), used on the free paths.
  formToken?: string | null;
  honeypot?: string | null;
}): Promise<CheckoutResult> {
  const name = fields.customerName.trim();
  const email = fields.customerEmail.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (!(fields.quantity > 0) || !Number.isInteger(fields.quantity)) return { ok: false, error: "Select at least one ticket." };
  // A cap per checkout, so a script can't hold a whole screening in one go.
  if (fields.quantity > MAX_TICKETS_PER_ORDER) return { ok: false, error: `Up to ${MAX_TICKETS_PER_ORDER} tickets per order online. For a bigger group, call or stop by the box office.` };
  // ...and a cap per connection, so it can't just check out again and again
  // (each pending checkout holds its seats for 30 minutes).
  if (!(await allowFromConnection("tickets"))) return { ok: false, error: TOO_MANY_FROM_CONNECTION };

  const supabase = createAdminClient();

  const { data: screening, error: screeningErr } = await supabase
    .from("screenings")
    .select("id, ticket_price, capacity, starts_at, movie:movies(title)")
    .eq("id", fields.screeningId)
    .single();
  if (screeningErr || !screening) return { ok: false, error: "Screening not found." };
  const movie = screening.movie as unknown as { title: string };

  const origin = await siteOrigin();

  // Only the signed-in member booking under their own email is "them": the
  // booking goes in their history, and the Insiders+ free seat is theirs.
  // Anyone else's booking is saved with no member, so a stranger can't put
  // bookings in a member's history by typing their email. A paid one joins
  // the history of the member with that email once it's paid (the Stripe
  // webhook), so a member who checks out signed out still earns points.
  const me = await getSignedInMember();
  const signedInSelf = me && sameEmail(me.email, email) ? me : null;

  // Insiders+ members get free entry to every screening (their own ticket)
  // -- matching the old site's booking flow, which separated "free tickets"
  // (covered by membership) from "additional passes" (always charged).
  // Only for the signed-in member, never for whoever types their email, and
  // one free seat per screening: a second booking for the same show is paid.
  // The free seat is saved as its own $0 booking, so reports never count it
  // as paid. hold_online_seats makes the final call under a lock; this
  // check only says which way the order is likely to go.
  const free = screening.ticket_price === 0;
  const wantsFreeSeat = !free && !!signedInSelf && hasPlusPerks(signedInSelf) && !(await memberHasBookingFor(fields.screeningId, signedInSelf.id));

  // Free screenings (the outdoor cinema, sponsored by the Royale Cinema
  // Project) and an order the membership covers whole skip Stripe entirely
  // -- there's no reason to send someone to a payment processor to pay
  // nothing. With no card in the way, these get the bot check.
  if (free || (wantsFreeSeat && fields.quantity === 1)) {
    const notHuman = checkHuman("tickets", fields);
    if (notHuman) return { ok: false, error: notHuman };
  }

  // Counts the seats and saves the booking in one step, with the screening
  // locked, so two checkouts at the same moment can't both take the last
  // seat (or both get the free one).
  const { data: hold, error: holdErr } = await supabase.rpc("hold_online_seats", {
    p_screening_id: fields.screeningId,
    p_quantity: fields.quantity,
    p_unit_price: screening.ticket_price,
    p_customer_name: name,
    p_customer_email: email,
    p_member_id: signedInSelf?.id ?? null,
    p_plus_seat: wantsFreeSeat,
  });
  if (holdErr) throw holdErr;
  if (!hold) return { ok: false, error: "Screening not found." };
  const { booking_id: paidBookingId, free_booking_id: freeBookingId, seats_left: seatsLeft } = hold as SeatHold;
  if (!paidBookingId && !freeBookingId) return { ok: false, error: `Only ${seatsLeft} seat(s) left for this screening.` };

  // Nothing to pay (a free screening, or just their free seat): already
  // confirmed.
  if (free || !paidBookingId) {
    return { ok: true, url: `${origin}/showtimes/${fields.screeningId}?checkout=free&booking_id=${paidBookingId ?? freeBookingId}` };
  }
  const freeQuantity = freeBookingId ? 1 : 0;
  const paidQuantity = fields.quantity - freeQuantity;
  const holdIds = freeBookingId ? [paidBookingId, freeBookingId] : [paidBookingId];

  const showtime = new Date(screening.starts_at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });

  const stripe = getStripe();
  let session;
  try {
    // Missouri sales tax goes on top of the ticket price (Stripe adds it).
    const taxRate = await salesTaxRateId();
    const lineItems = [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(screening.ticket_price * 100),
          product_data: { name: `${movie.title} — ${showtime}` },
        },
        quantity: paidQuantity,
        tax_rates: [taxRate],
      },
    ];
    if (freeQuantity > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: 0,
          product_data: { name: `${movie.title} — ${showtime} (Insiders+ free entry)` },
        },
        quantity: freeQuantity,
        tax_rates: [taxRate],
      });
    }
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: lineItems,
      // The webhook confirms (or cancels) the free seat with the paid
      // booking: it finds it by bookings.paid_booking_id.
      metadata: { booking_id: paidBookingId, screening_id: fields.screeningId, ...(freeBookingId ? { free_booking_id: freeBookingId } : {}) },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
      success_url: `${origin}/showtimes/${fields.screeningId}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/showtimes/${fields.screeningId}?checkout=cancelled`,
    });
  } catch (e) {
    // Release the seat hold if Stripe session creation failed.
    await supabase.from("bookings").delete().in("id", holdIds);
    throw e;
  }

  await supabase.from("bookings").update({ stripe_checkout_session_id: session.id }).in("id", holdIds);

  return { ok: true, url: session.url! };
}

// What hold_online_seats (supabase/migrations/20261001130000_booking_guards.sql)
// returns: the paid seats' booking and the free seat's, or neither when the
// seats ran out.
type SeatHold = { booking_id: string | null; free_booking_id: string | null; seats_left: number };
