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

export interface StartBoothCheckoutFields {
  boothId: string;
  reservationDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  partySize: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export async function startBoothCheckout(fields: StartBoothCheckoutFields): Promise<{ url: string }> {
  const name = fields.customerName.trim();
  const email = fields.customerEmail.trim();
  const phone = fields.customerPhone.trim();
  if (!name) throw new Error("Enter your name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email.");
  if (!(fields.partySize > 0)) throw new Error("Enter your party size.");
  if (!fields.reservationDate || !fields.startTime) throw new Error("Pick a date and time.");

  const supabase = createAdminClient();

  const { data: booth, error: boothErr } = await supabase
    .from("booths")
    .select("id, label, capacity, reservation_fee, active")
    .eq("id", fields.boothId)
    .single();
  if (boothErr || !booth || !booth.active) throw new Error("That booth isn't available.");
  if (fields.partySize > booth.capacity) {
    throw new Error(`${booth.label} seats up to ${booth.capacity} people.`);
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
    throw new Error(`${booth.label} is already reserved for part of that window. Pick another time or booth.`);
  }

  const { data: member } = await supabase.from("members").select("id").ilike("email", email).maybeSingle();

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

  const origin = await siteOrigin();
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

  return { url: session.url! };
}
