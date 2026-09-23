import { createClient } from "@/lib/supabase/server";
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

// Our MPLC umbrella license covers public performance of anything, but only
// lets us *advertise* the current year's releases -- an older title (like a
// library/catalog screening) can be shown, but only people we've told about
// it privately (the members' email list) are supposed to find out it's
// playing. So it must never appear on a page anyone can just browse to.
// A movie with no confirmed release year (not yet matched to OMDb/TMDb) is
// treated as restricted too -- fail closed, not open.
export function isRestrictedRelease(movie: { release_year: number | null }): boolean {
  return movie.release_year !== new Date().getFullYear();
}

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
