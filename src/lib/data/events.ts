import { createAdminClient } from "@/lib/supabase/admin";

export interface EventRecord {
  id: string;
  room_id: string;
  event_name: string;
  movie_title: string | null;
  guest_count: number | null;
  pizza_count: number | null;
  hours: number;
  event_date: string;
  event_time: string;
  organizer_name: string | null;
  organizer_email: string;
  estimate_total: number;
  deposit_paid: number;
  balance_due: number;
  status: "outstanding" | "paid";
  created_at: string;
  room: { id: string; name: string; capacity: number };
}

// No public-read RLS policy on events -- organizer contact info is
// sensitive. Always read via the service-role client, and only surface
// individual event details back to the public through the (site) events
// action's own return value, never a general listing.
export async function getUpcomingEvents(): Promise<EventRecord[]> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("events")
    .select("*, room:rooms(id, name, capacity)")
    .gte("event_date", today)
    .order("event_date")
    .order("event_time");
  if (error) throw error;
  return (data ?? []) as unknown as EventRecord[];
}
