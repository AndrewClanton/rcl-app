import { createAdminClient } from "@/lib/supabase/admin";
import type { Booth, BoothReservation } from "@/lib/types";

// Locked down like events/members -- reservations carry customer contact
// info, and the public booth page fetches everything server-side, so
// there's no public read policy to worry about.
export async function getActiveBooths(): Promise<Booth[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("booths").select("*").eq("active", true).order("sort_order");
  if (error) throw error;
  return (data ?? []) as Booth[];
}

// Admin management view -- includes inactive booths too.
export async function getAllBooths(): Promise<Booth[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("booths").select("*").order("sort_order");
  if (error) throw error;
  return (data ?? []) as Booth[];
}

// Which booths are taken when on a given date, for the public booth page.
// Only the booth and the window -- never who booked it (this goes to any
// visitor's browser).
export type BoothBusy = Pick<BoothReservation, "booth_id" | "start_time" | "hours">;

export async function getBoothBusyTimes(date: string): Promise<BoothBusy[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("booth_reservations")
    .select("booth_id, start_time, hours")
    .eq("reservation_date", date)
    .in("status", ["pending", "confirmed"])
    .order("start_time");
  if (error) throw error;
  return (data ?? []) as BoothBusy[];
}

// All reservations (including cancelled, so the admin calendar can show a
// slot's history) whose date falls within [start, end) -- used by the admin
// booth calendar, one calendar month at a time.
export async function getBoothReservationsForMonth(start: string, end: string): Promise<BoothReservation[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("booth_reservations")
    .select("*, booth:booths(*)")
    .gte("reservation_date", start)
    .lt("reservation_date", end)
    .order("reservation_date")
    .order("start_time");
  if (error) throw error;
  return (data ?? []) as unknown as BoothReservation[];
}

export async function getUpcomingBoothReservations(): Promise<BoothReservation[]> {
  const supabase = createAdminClient();
  // Central time, not server-local UTC -- Vercel runs UTC, so a plain
  // toISOString() slice would drop "today's" reservations from the list
  // for several hours every evening once Central crosses into a new UTC day.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { data, error } = await supabase
    .from("booth_reservations")
    .select("*, booth:booths(*)")
    .gte("reservation_date", today)
    .in("status", ["pending", "confirmed"])
    .order("reservation_date")
    .order("start_time");
  if (error) throw error;
  return (data ?? []) as unknown as BoothReservation[];
}
