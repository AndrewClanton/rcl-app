import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CALENDAR_STATUS_KEY, readStatus, type CalendarSyncStatus } from "@/lib/calendar-status";

// The schedule check's last result (src/lib/calendar-status.ts), or null
// when there isn't one or it can't be read.
export async function getCalendarStatus(): Promise<CalendarSyncStatus | null> {
  try {
    const { data, error } = await createAdminClient().from("settings").select("value").eq("key", CALENDAR_STATUS_KEY).maybeSingle();
    if (error) return null;
    return readStatus(data?.value);
  } catch {
    return null;
  }
}
