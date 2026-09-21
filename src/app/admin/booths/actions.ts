"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { verifyManagerPin } from "@/app/admin/reports/actions";
import { getBoothReservationsForMonth } from "@/lib/data/booths";
import type { BoothReservation } from "@/lib/types";

// monthStart is the first day of the month, e.g. "2026-09-01".
export async function getReservationsForMonth(monthStart: string): Promise<BoothReservation[]> {
  const [y, m] = monthStart.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return getBoothReservationsForMonth(monthStart, nextMonth);
}

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

export async function uploadBoothPhoto(boothId: string, formData: FormData) {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a photo to upload.");
  if (!file.type.startsWith("image/")) throw new Error("File must be an image.");

  const supabase = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  // Timestamped filename -- avoids needing to delete the old file first, and
  // sidesteps any stale-cache issue from re-using the same path/URL.
  const path = `${boothId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage.from("booth-photos").upload(path, buffer, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = supabase.storage.from("booth-photos").getPublicUrl(path);

  const { error } = await supabase.from("booths").update({ photo_url: urlData.publicUrl }).eq("id", boothId);
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
