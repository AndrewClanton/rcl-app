"use server";

import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getBoothBusyTimes, type BoothBusy } from "@/lib/data/booths";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks } from "@/lib/plus-status";
import { sameEmail } from "@/lib/email-match";
import { notifyBoothConfirmed } from "@/lib/booth-notify";
import { allowFromConnection, checkHuman, TOO_MANY_FROM_CONNECTION } from "@/lib/public-form-guard";

export async function getAvailabilityForDate(date: string): Promise<BoothBusy[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return getBoothBusyTimes(date);
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// Insiders+ free reservations per calendar month, by the month the
// reservation is FOR (not the month it was booked in). Counted by
// claim_free_booth in the database.
const FREE_RESERVATIONS_PER_MONTH = 2;

export interface StartBoothCheckoutFields {
  boothId: string;
  reservationDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  partySize: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  // The page's bot check (lib/public-form-guard.ts), used on the free path.
  formToken?: string | null;
  honeypot?: string | null;
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
  // A cap per connection: each pending checkout holds the booth for 30
  // minutes, so a script mustn't be able to hold them all.
  if (!(await allowFromConnection("booths"))) return { ok: false, error: TOO_MANY_FROM_CONNECTION };

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

  // Only the signed-in member booking under their own email is "them": the
  // reservation goes in their history, and the perk is theirs -- never
  // whoever types a member's email. Anyone else's is saved with no member,
  // and joins the history of the member with that email once it's paid
  // (the Stripe webhook).
  const me = await getSignedInMember();
  const self = me && sameEmail(me.email, email) ? me : null;
  const perkMember = self && hasPlusPerks(self) ? self : null;
  const origin = await siteOrigin();

  // Insiders+ perk: 2 free booth reservations per calendar month (counted
  // by the month the reservation is FOR), same "skip Stripe, confirm
  // immediately" pattern as Insiders+ free screening entry. claim_free_booth
  // counts and books in one step with the member locked, so two taps at the
  // same moment can't both get a free one past the limit.
  if (perkMember) {
    // No card in the way on the free path, so it gets the bot check.
    const notHuman = checkHuman("booths", fields);
    if (notHuman) return { ok: false, error: notHuman };
    const { data: freeId, error: freeErr } = await supabase.rpc("claim_free_booth", {
      p_member_id: perkMember.id,
      p_per_month: FREE_RESERVATIONS_PER_MONTH,
      p_booth_id: fields.boothId,
      p_customer_name: name,
      p_customer_email: email,
      p_customer_phone: phone || null,
      p_party_size: fields.partySize,
      p_reservation_date: fields.reservationDate,
      p_start_time: fields.startTime,
      p_hours: hours,
    });
    if (freeErr) throw freeErr;
    // Null: both free ones this month are used, so this one is paid.
    if (freeId) {
      await notifyBoothConfirmed(freeId as string);
      return { ok: true, url: `${origin}/booths?checkout=free&reservation_id=${freeId}` };
    }
  }

  const { data: reservation, error: insertErr } = await supabase
    .from("booth_reservations")
    .insert({
      booth_id: fields.boothId,
      member_id: self?.id ?? null,
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
