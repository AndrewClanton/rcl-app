import { createClient } from "@/lib/supabase/server";
import { isRestrictedRelease } from "@/lib/mplc";
import type { Screening } from "@/lib/types";

export const PUBLIC_SCHEDULE_WINDOW_DAYS = 14;

// Whether a screening's start time falls inside the public visibility
// window -- used to gate a direct link to a not-yet-public screening's own
// detail/booking page, not just the listing pages.
export function isWithinPublicWindow(startsAt: string): boolean {
  const start = new Date(startsAt).getTime();
  const now = Date.now();
  const windowEnd = now + PUBLIC_SCHEDULE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return start >= now && start <= windowEnd;
}

// Upcoming screenings (now and later), soonest first, with movie + room
// joined. Unwindowed -- for staff/admin tools that need to see and manage
// the full future schedule regardless of what's public yet.
export async function getUpcomingScreenings(): Promise<Screening[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");

  if (error) throw error;
  return (data ?? []) as unknown as Screening[];
}

// For in-venue countdown screens: every screening from `sinceMinutes` ago
// onward, so the film that just started stays up while latecomers arrive.
// Unfiltered by MPLC restriction -- only call this from a staff-gated page.
// Also returns the server's clock at fetch time, which the screen uses as
// its time reference instead of the TV's own clock.
export async function getScreeningsForCountdown(sinceMinutes: number, limit = 40): Promise<{ screenings: Screening[]; fetchedAt: number }> {
  const supabase = await createClient();
  const fetchedAt = Date.now();
  const since = new Date(fetchedAt - sinceMinutes * 60 * 1000);

  const { data, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", since.toISOString())
    .order("starts_at")
    .limit(limit);

  if (error) throw error;
  return { screenings: (data ?? []) as unknown as Screening[], fetchedAt };
}

export { isRestrictedRelease };

export function excludeRestrictedReleases(screenings: Screening[]): Screening[] {
  return screenings.filter((s) => !isRestrictedRelease(s.movie));
}

// Same as getUpcomingScreenings, but only screenings starting within the
// next PUBLIC_SCHEDULE_WINDOW_DAYS, and excluding anything our MPLC license
// doesn't allow us to advertise -- this is what the public site (and
// anything a visitor can see without being in the building) shows. Matches
// the "we don't publish a full public schedule" policy: the schedule can be
// entered into the system as far out as staff like, but times only appear
// on the public site once they're within the window.
export async function getPubliclyVisibleScreenings(): Promise<Screening[]> {
  const supabase = await createClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + PUBLIC_SCHEDULE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", now.toISOString())
    .lte("starts_at", windowEnd.toISOString())
    .order("starts_at");

  if (error) throw error;
  return excludeRestrictedReleases((data ?? []) as unknown as Screening[]);
}
