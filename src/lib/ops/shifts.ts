import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "./time";

// Start shift on the register, once the person is checked (the caller does
// that). An open shift from earlier in the same business day (4 AM to 4 AM
// Central) is the same shift, so a double tap never makes two. One from an
// earlier business day is a forgotten End shift: it stays open, so Team →
// Timesheets flags it for a manager to set the real clock-out, and a fresh
// shift starts now. (Continuing it silently counted a whole night and day
// as one shift.)
//
// `at` is for the checks script (far-past throwaway shifts); the register
// leaves it out and the database stamps the time.
export async function startShiftFor(employeeId: string, at?: Date): Promise<{ ok: true; shiftId: string; reused: boolean } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const day = businessDayWindow(businessDay(at ?? new Date()).date);
  const sameDay = () =>
    supabase
      .from("shifts")
      .select("id")
      .eq("employee_id", employeeId)
      .is("ended_at", null)
      .gte("started_at", day.start)
      .lt("started_at", day.end)
      .order("started_at")
      .order("id")
      .limit(1);
  const failed = { ok: false as const, error: "Couldn't start the shift. Try again." };

  const { data: open, error } = await sameDay();
  if (error) return failed;
  if (open?.[0]) return { ok: true, shiftId: open[0].id as string, reused: true };

  const { data: made, error: startError } = await supabase
    .from("shifts")
    .insert({ employee_id: employeeId, ...(at ? { started_at: at.toISOString() } : {}) })
    .select("id")
    .single();
  if (startError || !made) return failed;
  // Two taps at once can both get this far: keep the first shift, drop ours.
  const { data: first } = await sameDay();
  const keep = first?.[0]?.id as string | undefined;
  if (keep && keep !== made.id) {
    await supabase.from("shifts").delete().eq("id", made.id).is("ended_at", null);
    return { ok: true, shiftId: keep, reused: true };
  }
  return { ok: true, shiftId: made.id as string, reused: false };
}
