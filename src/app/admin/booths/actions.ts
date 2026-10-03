"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { checkManagerPin, recordApprover } from "@/lib/manager-pin";
import type { ApprovalResult } from "@/lib/pin-rules";
import { getBoothReservationsForMonth } from "@/lib/data/booths";
import type { BoothReservation } from "@/lib/types";
import { assertStaff } from "@/lib/auth";

// monthStart is the first day of the month, e.g. "2026-09-01". Guests'
// contact details come back shortened for a cashier, same as the page.
export async function getReservationsForMonth(monthStart: string): Promise<BoothReservation[]> {
  const staff = await assertStaff();
  const [y, m] = monthStart.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return getBoothReservationsForMonth(monthStart, nextMonth, staff.role);
}

function revalidate() {
  revalidatePath("/admin/booths");
}

// Both return { ok: false, error } rather than throwing: production hides a
// thrown message, so "File must be an image." used to reach the screen as
// a generic error, and a failed save showed nothing at all.
type Result = { ok: true } | { ok: false; error: string };

export async function updateBooth(boothId: string, fields: { capacity: number; reservationFee: number; active: boolean }): Promise<Result> {
  await assertStaff();
  if (!(Number.isInteger(fields.capacity) && fields.capacity > 0)) return { ok: false, error: "Capacity has to be at least 1." };
  if (!(fields.reservationFee >= 0)) return { ok: false, error: "Enter a fee of $0.00 or more." };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("booths")
    .update({ capacity: fields.capacity, reservation_fee: fields.reservationFee, active: fields.active })
    .eq("id", boothId);
  if (error) return { ok: false, error: "Couldn't save that booth. Try again." };
  revalidate();
  return { ok: true };
}

export async function uploadBoothPhoto(boothId: string, formData: FormData): Promise<Result> {
  await assertStaff();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo to upload." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "That file isn't a picture. Choose a JPG or PNG." };

  const supabase = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  // Timestamped filename -- avoids needing to delete the old file first, and
  // sidesteps any stale-cache issue from re-using the same path/URL.
  const path = `${boothId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage.from("booth-photos").upload(path, buffer, { contentType: file.type });
  if (uploadErr) return { ok: false, error: "The photo didn't upload. Try again, or try a smaller photo." };

  const { data: urlData } = supabase.storage.from("booth-photos").getPublicUrl(path);

  const { error } = await supabase.from("booths").update({ photo_url: urlData.publicUrl }).eq("id", boothId);
  if (error) return { ok: false, error: "The photo uploaded but wasn't saved to the booth. Try again." };
  revalidate();
  return { ok: true };
}

// Returns the reason on failure (a wrong PIN, the lock), since a thrown
// message is hidden in production, and on success whose PIN approved it.
export async function cancelBoothReservation(reservationId: string, pin: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "booth-cancel", staff.employeeId, reservationId);
  if (!approval.ok) return approval;

  const supabase = createAdminClient();
  const { data: reservation, error: fetchErr } = await supabase
    .from("booth_reservations")
    .select("status, stripe_payment_intent_id")
    .eq("id", reservationId)
    .single();
  if (fetchErr || !reservation) return { ok: false, error: "Reservation not found." };
  if (reservation.status === "cancelled") return { ok: false, error: "This reservation was already cancelled." };

  if (reservation.stripe_payment_intent_id) {
    try {
      await getStripe().refunds.create({ payment_intent: reservation.stripe_payment_intent_id });
    } catch (e) {
      const message = e instanceof Error ? e.message : null;
      return { ok: false, error: `The card refund didn't go through${message ? ` (Stripe: ${message})` : ""}. Nothing was changed.` };
    }
  }
  const { error } = await supabase.from("booth_reservations").update({ status: "cancelled" }).eq("id", reservationId);
  if (error) throw error;
  await recordApprover("booth_reservations", reservationId, approval.approverId);
  revalidate();
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}
