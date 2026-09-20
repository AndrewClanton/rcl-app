"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { verifyManagerPin } from "@/app/admin/reports/actions";

function revalidate() {
  revalidatePath("/admin/booths");
}

export async function updateBooth(boothId: string, fields: { capacity: number; reservationFee: number; active: boolean }) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("booths")
    .update({ capacity: fields.capacity, reservation_fee: fields.reservationFee, active: fields.active })
    .eq("id", boothId);
  if (error) throw error;
  revalidate();
}

export async function cancelBoothReservation(reservationId: string, pin: string) {
  const ok = await verifyManagerPin(pin);
  if (!ok) throw new Error("Incorrect manager PIN.");

  const supabase = createAdminClient();
  const { data: reservation, error: fetchErr } = await supabase
    .from("booth_reservations")
    .select("status, stripe_payment_intent_id")
    .eq("id", reservationId)
    .single();
  if (fetchErr || !reservation) throw new Error("Reservation not found.");
  if (reservation.status === "cancelled") throw new Error("This reservation was already cancelled.");

  if (reservation.stripe_payment_intent_id) {
    await getStripe().refunds.create({ payment_intent: reservation.stripe_payment_intent_id });
  }
  const { error } = await supabase.from("booth_reservations").update({ status: "cancelled" }).eq("id", reservationId);
  if (error) throw error;
  revalidate();
}
