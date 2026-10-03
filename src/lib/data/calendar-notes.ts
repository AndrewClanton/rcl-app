import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import type { CalendarNote } from "@/lib/types";

// Staff-only, same posture as events -- no public read policy. From
// tonight's business day on, like events (a UTC date is tomorrow by 7 PM).
export async function getUpcomingCalendarNotes(): Promise<CalendarNote[]> {
  const supabase = createAdminClient();
  const today = businessDay().date;
  const { data, error } = await supabase
    .from("calendar_notes")
    .select("*")
    .gte("note_date", today)
    .order("note_date")
    .order("start_time", { nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as CalendarNote[];
}
