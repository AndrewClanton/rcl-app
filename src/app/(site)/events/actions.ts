"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateEventTotal } from "@/lib/eventPricing";
import type { Room } from "@/lib/types";

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
}): Promise<{ estimate: number }> {
  if (!fields.roomId) throw new Error("Select a space.");
  if (!(fields.hours > 0)) throw new Error("Enter the number of hours.");
  if (!fields.eventDate) throw new Error("Enter an event date.");
  if (!fields.eventTime) throw new Error("Enter an event time.");
  if (!fields.organizerEmail || !fields.organizerEmail.includes("@")) throw new Error("Enter a valid email.");

  const supabase = createAdminClient();
  const { data: room, error: roomErr } = await supabase
    .from("rooms")
    .select("*, addons:room_addons(*)")
    .eq("id", fields.roomId)
    .single();
  if (roomErr || !room) throw new Error("Room not found");

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
  return { estimate };
}
