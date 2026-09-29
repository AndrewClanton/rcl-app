import { getScreeningsForCountdown, excludeRestrictedReleases } from "@/lib/data/screenings";
import BoxOfficeSignage from "./BoxOfficeSignage";
import { NOW_SHOWING_MINUTES, shortRoom, type BoardShow } from "./board";

export const dynamic = "force-dynamic";

// No staff auth here -- this is a public lobby/box-office TV. Screenings
// are read on the server (the public key can't read them), so it keeps
// working unattended without a login. Same MPLC advertising restriction as
// the rest of the public site applies -- see excludeRestrictedReleases.
//
// Reads from NOW_SHOWING_MINUTES ago, so a show that just started stays up
// (tagged NOW SHOWING) for latecomers. Only the fields the screen shows are
// sent to the browser -- not ticket counts, revenue, or staff notes.
export default async function BoxOfficePage() {
  const { screenings, fetchedAt } = await getScreeningsForCountdown(NOW_SHOWING_MINUTES);
  const shows: BoardShow[] = excludeRestrictedReleases(screenings)
    .slice(0, 12)
    .map((s) => ({
      id: s.id,
      title: s.movie.title,
      startsAt: new Date(s.starts_at).getTime(),
      room: shortRoom(s.room.name),
      rating: s.movie.rating,
      runtimeMinutes: s.movie.runtime_minutes,
      posterUrl: s.movie.poster_url,
    }));
  return <BoxOfficeSignage shows={shows} serverNow={fetchedAt} />;
}
