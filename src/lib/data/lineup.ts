import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRestrictedRelease } from "@/lib/mplc";
import { isWithinPublicWindow } from "@/lib/data/screenings";
import { businessDayWindow, shiftDate } from "@/lib/ops/time";
import type { LineupData, LineupFilm, LineupHappening } from "@/lib/email/lineup-email";

// What's on at the Royale over some business days, for the members' lineup
// email: every screening still to come, grouped by film (older MPLC titles
// flagged `archive`), plus the house events (trivia, comedy, the book swap).
// Private rentals are never included. Only showings inside the public
// window are listed, since that's how far ahead a showtime's own page (the
// email's ticket link) opens.
export const LINEUP_MAX_DAYS = 14;

interface Row {
  id: string;
  starts_at: string;
  movie: { id: string; title: string; poster_url: string | null; rating: string | null; runtime_minutes: number | null; release_year: number | null } | null;
}

export async function getLineup(start: string, days: number): Promise<LineupData> {
  const n = Math.max(1, Math.min(LINEUP_MAX_DAYS, Math.floor(days) || 7));
  const from = businessDayWindow(start).start;
  const to = businessDayWindow(shiftDate(start, n - 1)).end;
  const now = new Date().toISOString();
  const lower = from > now ? from : now;
  const supabase = createAdminClient();

  const [screenings, happenings] = await Promise.all([
    supabase
      .from("screenings")
      .select("id, starts_at, movie:movies(id, title, poster_url, rating, runtime_minutes, release_year)")
      .gte("starts_at", lower)
      .lt("starts_at", to)
      .order("starts_at"),
    supabase.from("house_events").select("id, title, note, starts_at").gte("starts_at", lower).lt("starts_at", to).order("starts_at"),
  ]);
  if (screenings.error) throw new Error("Couldn't load the showtimes.");
  if (happenings.error) throw new Error("Couldn't load the house events.");

  const films = new Map<string, LineupFilm>();
  for (const s of (screenings.data ?? []) as unknown as Row[]) {
    if (!s.movie || !isWithinPublicWindow(s.starts_at)) continue;
    let f = films.get(s.movie.id);
    if (!f) {
      f = {
        movieId: s.movie.id,
        title: s.movie.title,
        posterUrl: s.movie.poster_url,
        rating: s.movie.rating,
        runtime: s.movie.runtime_minutes,
        archive: isRestrictedRelease(s.movie),
        showtimes: [],
      };
      films.set(s.movie.id, f);
    }
    f.showtimes.push({ id: s.id, startsAt: s.starts_at });
  }

  return {
    rangeStart: start,
    rangeDays: n,
    films: [...films.values()],
    happenings: ((happenings.data ?? []) as { id: string; title: string; note: string | null; starts_at: string }[]).map(
      (h): LineupHappening => ({ id: h.id, title: h.title, note: h.note, startsAt: h.starts_at }),
    ),
  };
}
