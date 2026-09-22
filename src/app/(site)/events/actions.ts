"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateEventTotal } from "@/lib/eventPricing";
import type { Room } from "@/lib/types";

// Next.js redacts a *thrown* Server Action error's message in production
// builds (only a generic "Minified React error..." reaches the client --
// the real text only ever shows in dev). Expected, user-actionable errors
// are modeled as return values instead, per Next's own guidance, so the
// real message reaches the client in every environment. Genuine
// unexpected failures (a DB error) are left as throws below.
export type EventInquiryResult = { ok: true; estimate: number } | { ok: false; error: string };

export async function submitEventInquiry(fields: {
  roomId: string;
  hours: number;
  addonIds: string[];
  eventDate: string;
  eventTime: string;
  eventName: string;
  movieTitle: string;
  guestCount: number | null;
  pizzaCount: number | null;
  organizerName: string;
  organizerEmail: string;
}): Promise<EventInquiryResult> {
  if (!fields.roomId) return { ok: false, error: "Select a space." };
  if (!(fields.hours > 0)) return { ok: false, error: "Enter the number of hours." };
  if (!fields.eventDate) return { ok: false, error: "Enter an event date." };
  if (!fields.eventTime) return { ok: false, error: "Enter an event time." };
  if (!fields.organizerEmail || !fields.organizerEmail.includes("@")) return { ok: false, error: "Enter a valid email." };

  const supabase = createAdminClient();
  const { data: room, error: roomErr } = await supabase
    .from("rooms")
    .select("*, addons:room_addons(*)")
    .eq("id", fields.roomId)
    .single();
  if (roomErr || !room) return { ok: false, error: "Room not found" };

  const estimate = estimateEventTotal(room as unknown as Room, fields.hours, fields.addonIds);

  const { error } = await supabase.from("events").insert({
    room_id: fields.roomId,
    event_name: fields.eventName.trim() || "Untitled event",
    movie_title: fields.movieTitle.trim() || null,
    guest_count: fields.guestCount,
    pizza_count: fields.pizzaCount,
    hours: fields.hours,
    event_date: fields.eventDate,
    event_time: fields.eventTime,
    organizer_name: fields.organizerName.trim() || null,
    organizer_email: fields.organizerEmail.trim(),
    estimate_total: estimate,
    deposit_paid: 0,
    balance_due: estimate,
    status: "outstanding",
  });
  if (error) throw error;

  revalidatePath("/admin/events");
  return { ok: true, estimate };
}
