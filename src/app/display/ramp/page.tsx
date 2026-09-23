import { requireDisplayScreen } from "@/lib/auth";
import { getScreeningsForCountdown } from "@/lib/data/screenings";
import RampCountdown from "./RampCountdown";
import { NOW_PLAYING_MINUTES, type RampScreening } from "./schedule";

export const dynamic = "force-dynamic";

// Portrait TV at the base of the ramp up to the theater: counts down to the
// next film, keeps it up for NOW_PLAYING_MINUTES after it starts, then moves
// on to the one after.
//
// Shows every title in full, including older MPLC-restricted ones -- Andrew's
// call for an in-building screen (2026-09-23). That's only OK because this
// page is behind a login (staff, or the TV's own signage-only 'display'
// account); an open URL (like /display/box-office) would put those titles
// on the public web.
export default async function RampDisplayPage({ searchParams }: { searchParams: Promise<{ rotate?: string }> }) {
  const { rotate } = await searchParams;
  await requireDisplayScreen(rotate ? `/display/ramp?rotate=${encodeURIComponent(rotate)}` : "/display/ramp");
  const { screenings, fetchedAt } = await getScreeningsForCountdown(NOW_PLAYING_MINUTES);

  const items: RampScreening[] = screenings.map((s) => ({
    id: s.id,
    startsAt: new Date(s.starts_at).getTime(),
    title: s.movie.title,
    posterUrl: s.movie.poster_url,
    rating: s.movie.rating,
    runtimeMinutes: s.movie.runtime_minutes,
    room: s.room.name.split(" — ")[0],
  }));

  return <RampCountdown screenings={items} serverNow={fetchedAt} rotate={rotate === "ccw" || rotate === "off" ? rotate : "cw"} />;
}
