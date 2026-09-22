"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

// Vercel/Next set these on the incoming request; falls back to localhost
// for `next dev`. Avoids needing a hardcoded NEXT_PUBLIC_SITE_URL that
// would have to differ between local/preview/production.
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Next.js redacts a *thrown* Server Action error's message in production
// builds (only a generic "Minified React error..." reaches the client --
// the real text only ever shows in dev). Expected, user-actionable errors
// are modeled as return values instead, per Next's own guidance, so the
// real message reaches the client in every environment. Genuine
// unexpected failures (a DB/Stripe error) are left as throws below.
export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

export async function startCheckout(fields: { screeningId: string; quantity: number; customerName: string; customerEmail: string }): Promise<CheckoutResult> {
  const name = fields.customerName.trim();
  const email = fields.customerEmail.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (!(fields.quantity > 0)) return { ok: false, error: "Select at least one ticket." };

  const supabase = createAdminClient();

  const { data: screening, error: screeningErr } = await supabase
    .from("screenings")
    .select("id, ticket_price, capacity, starts_at, movie:movies(title)")
    .eq("id", fields.screeningId)
    .single();
  if (screeningErr || !screening) return { ok: false, error: "Screening not found." };
  const movie = screening.movie as unknown as { title: string };

  const { data: existingBookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("quantity")
    .eq("screening_id", fields.screeningId)
    .in("status", ["pending", "confirmed"]);
  if (bookingsErr) throw bookingsErr;

  const booked = (existingBookings ?? []).reduce((s, b) => s + b.quantity, 0);
  if (booked + fields.quantity > screening.capacity) {
    return { ok: false, error: `Only ${Math.max(0, screening.capacity - booked)} seat(s) left for this screening.` };
  }

  const origin = await siteOrigin();

  // Free screenings (the outdoor cinema, sponsored by the Royale Cinema
  // Project) skip Stripe entirely -- there's no reason to send someone to a
  // payment processor to pay nothing.
  if (screening.ticket_price === 0) {
    const { data: member } = await supabase.from("members").select("id").ilike("email", email).maybeSingle();
    const { data: booking, error: insertErr } = await supabase
      .from("bookings")
      .insert({
        screening_id: fields.screeningId,
        member_id: member?.id ?? null,
        customer_name: name,
        customer_email: email,
        quantity: fields.quantity,
        unit_price: 0,
        status: "confirmed",
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    return { ok: true, url: `${origin}/showtimes/${fields.screeningId}?checkout=free&booking_id=${booking.id}` };
  }

  // Insiders+ members get unlimited free entry (their own ticket) --
  // matching the old site's booking flow, which separated "free tickets"
  // (covered by membership) from "additional passes" (always charged).
  // Any guest seats beyond the member's own still cost full price.
  const { data: member } = await supabase.from("members").select("id, tier").ilike("email", email).maybeSingle();
  const freeQuantity = member?.tier === "Insiders+" ? Math.min(1, fields.quantity) : 0;
  const paidQuantity = fields.quantity - freeQuantity;

  if (paidQuantity === 0) {
    // Fully covered by membership -- no payment needed, confirm immediately.
    const { data: booking, error: insertErr } = await supabase
      .from("bookings")
      .insert({
        screening_id: fields.screeningId,
        member_id: member?.id ?? null,
        customer_name: name,
        customer_email: email,
        quantity: fields.quantity,
        unit_price: 0,
        status: "confirmed",
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    return { ok: true, url: `${origin}/showtimes/${fields.screeningId}?checkout=free&booking_id=${booking.id}` };
  }

  const { data: booking, error: insertErr } = await supabase
    .from("bookings")
    .insert({
      screening_id: fields.screeningId,
      member_id: member?.id ?? null,
      customer_name: name,
      customer_email: email,
      quantity: fields.quantity,
      unit_price: screening.ticket_price,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  const showtime = new Date(screening.starts_at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });

  const lineItems = [
    {
      price_data: {
        currency: "usd",
        unit_amount: Math.round(screening.ticket_price * 100),
        product_data: { name: `${movie.title} — ${showtime}` },
      },
      quantity: paidQuantity,
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
    });
  }

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: lineItems,
      metadata: { booking_id: booking.id, screening_id: fields.screeningId },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
      success_url: `${origin}/showtimes/${fields.screeningId}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/showtimes/${fields.screeningId}?checkout=cancelled`,
    });
  } catch (e) {
    // Release the seat hold if Stripe session creation failed.
    await supabase.from("bookings").delete().eq("id", booking.id);
    throw e;
  }

  await supabase.from("bookings").update({ stripe_checkout_session_id: session.id }).eq("id", booking.id);

  return { ok: true, url: session.url! };
}
