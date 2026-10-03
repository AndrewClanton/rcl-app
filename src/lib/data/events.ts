import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, seesFullContact } from "@/lib/contact-mask";
import { businessDay } from "@/lib/ops/time";
import type { EmployeeRole } from "@/lib/types";

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
//
// From tonight's business day on, not the UTC date: Vercel runs UTC, which
// is already tomorrow from 7 PM Central (6 PM in winter), and tonight's
// party (and its balance due) dropped off the list while it was on. The
// business day runs until 4 a.m., so a party still going after midnight
// stays listed too.
//
// A cashier gets the organizer's email shortened (lib/contact-mask.ts);
// managers and up see it in full.
export async function getUpcomingEvents(viewerRole: EmployeeRole): Promise<EventRecord[]> {
  const supabase = createAdminClient();
  const today = businessDay().date;
  const { data, error } = await supabase
    .from("events")
    .select("*, room:rooms(id, name, capacity)")
    .gte("event_date", today)
    .order("event_date")
    .order("event_time");
  if (error) throw error;
  const events = (data ?? []) as unknown as EventRecord[];
  if (seesFullContact(viewerRole)) return events;
  return events.map((e) => ({ ...e, organizer_email: maskEmail(e.organizer_email) ?? "" }));
}
