import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_SCREENINGS_TAG } from "@/lib/data/screenings";
import { applyPlan, buildPlan, loadSyncState, parseCalendar, readCalendarFile } from "@/lib/calendar-sync";
import { failedStatus, recordSyncStatus, statusFromPlan, type CalendarSyncStatus } from "@/lib/calendar-status";
import { DriveError, downloadCalendar, loadConnection, missingGoogleEnv } from "@/lib/google-drive-calendar";

export const DRIVE_SOURCE = "website (Google Drive)";

// The hourly sync from the connected Google Drive calendar
// (/api/cron/calendar-sync). The same rules as the Back office page, with
// nothing picked: the calendar wins, showings with tickets sold are flagged
// and never moved or removed, and titles that need a pick are left alone
// for a manager. A calendar that would mostly empty the schedule (an old
// copy?) isn't applied; it's recorded as a failed check instead.
//
// Without the env vars or a picked file it does nothing and records
// nothing, so it never overwrites another check's result.
export async function syncFromGoogleDrive(): Promise<{ skipped: string } | { status: CalendarSyncStatus }> {
  if (missingGoogleEnv().length) return { skipped: `not set up: ${missingGoogleEnv().join(", ")}` };
  const conn = await loadConnection();
  if (!conn) return { skipped: "Google Drive isn't connected" };
  if (!conn.fileId) return { skipped: "no calendar file picked" };
  const db = createAdminClient();
  let status: CalendarSyncStatus;
  try {
    const bytes = await downloadCalendar(conn);
    let cal;
    try {
      cal = parseCalendar(await readCalendarFile(bytes));
    } catch {
      throw new DriveError("The calendar from Google Drive couldn't be read as a spreadsheet.");
    }
    if (!cal.tabs.length) throw new DriveError("No month tabs (OCT, NOV, DEC...) with dates from today on were found in the calendar.");
    const plan = buildPlan(cal, await loadSyncState(db));
    if (plan.remove.length >= 10 && plan.remove.length > plan.add.length + plan.change.length) {
      throw new DriveError(`The calendar would remove ${plan.remove.length} showings, so nothing was changed. Check it with Sync from calendar.`);
    }
    const r = await applyPlan(db, plan, { id: null, name: "Hourly calendar check", file: conn.fileName ?? "Google Drive" });
    if (r.added || r.changed || r.removed) {
      revalidateTag(PUBLIC_SCREENINGS_TAG, { expire: 0 });
      revalidatePath("/admin/screenings");
      revalidatePath("/showtimes");
      revalidatePath("/");
    }
    status = statusFromPlan(plan, DRIVE_SOURCE, r);
  } catch (e) {
    if (!(e instanceof DriveError)) console.error("calendar sync from Google Drive", e);
    status = failedStatus(DRIVE_SOURCE, e instanceof DriveError ? e.message : "The sync hit an error. It will try again next hour.");
  }
  await recordSyncStatus(db, status);
  return { status };
}
