import { requireDisplayScreen } from "@/lib/auth";
import { getScreeningsForCountdown } from "@/lib/data/screenings";
import { getRecentHouseEvents } from "@/lib/data/house-events";
import NowPlayingScreen from "./NowPlayingScreen";
import { NOW_PLAYING_MINUTES, type NowPlayingFilm } from "./schedule";

export const dynamic = "force-dynamic";

// The Now Playing screen: a portrait TV near the theater entrance that counts
// down to the next film, keeps it up for NOW_PLAYING_MINUTES after it starts,
// then moves on to the one after. Its old address (from when it was "the ramp
// TV") redirects here; see next.config.ts.
//
// Shows every title in full, including older MPLC-restricted ones -- Andrew's
// call for an in-building screen (2026-09-23). That's only OK because this
// page is behind a login (staff, or the TV's own signage-only 'display'
// account); an open URL (like /display/box-office) would put those titles
// on the public web.
export default async function NowPlayingPage({ searchParams }: { searchParams: Promise<{ rotate?: string }> }) {
  const { rotate } = await searchParams;
  await requireDisplayScreen(rotate ? `/display/now-playing?rotate=${encodeURIComponent(rotate)}` : "/display/now-playing");
  const [{ screenings, fetchedAt }, events] = await Promise.all([
    getScreeningsForCountdown(NOW_PLAYING_MINUTES),
    getRecentHouseEvents(NOW_PLAYING_MINUTES),
  ]);

  // Trivia, comedy, the book swap: counted down just like the films.
  const houseEvents: NowPlayingFilm[] = events.map((e) => ({
    id: e.id,
    kind: "event",
    startsAt: new Date(e.starts_at).getTime(),
    endsAt: e.ends_at ? new Date(e.ends_at).getTime() : null,
    note: e.note,
    title: e.title,
    posterUrl: null,
    rating: null,
    runtimeMinutes: null,
    room: "The lounge",
  }));

  const films: NowPlayingFilm[] = screenings.map((s) => ({
    id: s.id,
    kind: "film",
    endsAt: null,
    note: null,
    startsAt: new Date(s.starts_at).getTime(),
    title: s.movie.title,
    posterUrl: s.movie.poster_url,
    rating: s.movie.rating,
    runtimeMinutes: s.movie.runtime_minutes,
    room: s.room.name.split(" — ")[0],
  }));

  const items = [...films, ...houseEvents].sort((a, b) => a.startsAt - b.startsAt);

  return <NowPlayingScreen screenings={items} serverNow={fetchedAt} rotate={rotate === "ccw" || rotate === "off" ? rotate : "cw"} />;
}
