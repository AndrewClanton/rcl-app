import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarNote } from "@/lib/types";

// Staff-only, same posture as events -- no public read policy.
export async function getUpcomingCalendarNotes(): Promise<CalendarNote[]> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("calendar_notes")
    .select("*")
    .gte("note_date", today)
    .order("note_date")
    .order("start_time", { nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as CalendarNote[];
}
