"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getBoothReservationsForDate } from "@/lib/data/booths";
import type { BoothReservation } from "@/lib/types";

export async function getAvailabilityForDate(date: string): Promise<BoothReservation[]> {
  return getBoothReservationsForDate(date);
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// [start, end) bounds for the calendar month that `dateStr` (YYYY-MM-DD)
// falls in -- used to cap Insiders+ free reservations at 2 per month, by
// the month the reservation is FOR (not the month it was booked in).
function monthBounds(dateStr: string) {
  const [y, m] = dateStr.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

const FREE_RESERVATIONS_PER_MONTH = 2;

export interface StartBoothCheckoutFields {
  boothId: string;
  reservationDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  partySize: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

// Next.js redacts a *thrown* Server Action error's message in production
// builds (only a generic "Minified React error..." reaches the client --
// the real text only ever shows in dev). Expected, user-actionable errors
// are modeled as return values instead, per Next's own guidance, so the
// real message reaches the client in every environment. Genuine
// unexpected failures (a DB/Stripe error) are left as throws below.
export type BoothCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

export async function startBoothCheckout(fields: StartBoothCheckoutFields): Promise<BoothCheckoutResult> {
  const name = fields.customerName.trim();
  const email = fields.customerEmail.trim();
  const phone = fields.customerPhone.trim();
  if (!name) return { ok: false, error: "Enter your name." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (!(fields.partySize > 0)) return { ok: false, error: "Enter your party size." };
  if (!fields.reservationDate || !fields.startTime) return { ok: false, error: "Pick a date and time." };
  // Never same-day -- so nobody books a seat out from under a customer
  // who's already sitting in it. Client-side <input min> mirrors this, but
  // don't trust that alone.
  if (fields.reservationDate <= todayCentral()) {
    return { ok: false, error: "Booths can be reserved starting tomorrow, not for today." };
  }

  const supabase = createAdminClient();

  const { data: booth, error: boothErr } = await supabase
    .from("booths")
    .select("id, label, capacity, reservation_fee, active")
    .eq("id", fields.boothId)
    .single();
  if (boothErr || !booth || !booth.active) return { ok: false, error: "That booth isn't available." };
  if (fields.partySize > booth.capacity) {
    return { ok: false, error: `${booth.label} seats up to ${booth.capacity} people.` };
  }

  const hours = 2;
  const newStart = timeToMinutes(fields.startTime);
  const newEnd = newStart + hours * 60;

  const { data: existing, error: existingErr } = await supabase
    .from("booth_reservations")
    .select("start_time, hours")
    .eq("booth_id", fields.boothId)
    .eq("reservation_date", fields.reservationDate)
    .in("status", ["pending", "confirmed"]);
  if (existingErr) throw existingErr;

  const overlaps = (existing ?? []).some((r) => {
    const s = timeToMinutes(r.start_time);
    const e = s + r.hours * 60;
    return newStart < e && newEnd > s;
  });
  if (overlaps) {
    return { ok: false, error: `${booth.label} is already reserved for part of that window. Pick another time or booth.` };
  }

  const { data: member } = await supabase.from("members").select("id, tier").ilike("email", email).maybeSingle();
  const origin = await siteOrigin();

  // Insiders+ perk: 2 free booth reservations per calendar month (counted
  // by the month the reservation is FOR), same "skip Stripe, confirm
  // immediately" pattern as Insiders+ free screening entry.
  if (member?.tier === "Insiders+") {
    const { start, end } = monthBounds(fields.reservationDate);
    const { count, error: countErr } = await supabase
      .from("booth_reservations")
      .select("id", { count: "exact", head: true })
      .eq("member_id", member.id)
      .eq("fee_amount", 0)
      .eq("status", "confirmed")
      .gte("reservation_date", start)
      .lt("reservation_date", end);
    if (countErr) throw countErr;

    if ((count ?? 0) < FREE_RESERVATIONS_PER_MONTH) {
      const { data: freeReservation, error: freeErr } = await supabase
        .from("booth_reservations")
        .insert({
          booth_id: fields.boothId,
          member_id: member.id,
          customer_name: name,
          customer_email: email,
          customer_phone: phone || null,
          party_size: fields.partySize,
          reservation_date: fields.reservationDate,
          start_time: fields.startTime,
          hours,
          fee_amount: 0,
          status: "confirmed",
        })
        .select("id")
        .single();
      if (freeErr) throw freeErr;
      return { ok: true, url: `${origin}/booths?checkout=free&reservation_id=${freeReservation.id}` };
    }
  }

  const { data: reservation, error: insertErr } = await supabase
    .from("booth_reservations")
    .insert({
      booth_id: fields.boothId,
      member_id: member?.id ?? null,
      customer_name: name,
      customer_email: email,
      customer_phone: phone || null,
      party_size: fields.partySize,
      reservation_date: fields.reservationDate,
      start_time: fields.startTime,
      hours,
      fee_amount: booth.reservation_fee,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  const dateLabel = new Date(`${fields.reservationDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(booth.reservation_fee * 100),
            product_data: { name: `${booth.label} reservation — ${dateLabel} at ${fields.startTime}` },
          },
          quantity: 1,
        },
      ],
      metadata: { booth_reservation_id: reservation.id },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${origin}/booths?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/booths?checkout=cancelled`,
    });
  } catch (e) {
    await supabase.from("booth_reservations").delete().eq("id", reservation.id);
    throw e;
  }

  await supabase.from("booth_reservations").update({ stripe_checkout_session_id: session.id }).eq("id", reservation.id);

  return { ok: true, url: session.url! };
}
