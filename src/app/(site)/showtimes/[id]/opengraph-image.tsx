import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRestrictedRelease, nextCentralYearStart } from "@/lib/mplc";
import { isWithinPublicWindow } from "@/lib/public-window";
import { BrandCard, SHARE_SIZE, ShowtimeCard, fetchPoster, loadShareAssets } from "@/lib/seo/share-card";

// A showtime's link preview: its poster, the film and the day and time, so a
// shared link says what's playing and when. Next adds it to the page's
// og:image (and the Twitter card picks it up) because it sits next to the
// page.
//
// MPLC: an older title must never be advertised (lib/mplc.ts), and a link
// preview is advertising. A restricted film, like a missing or past
// showtime, gets the plain site card: no title, no poster.
//
// Drawn per request (a database read, the poster download and the drawing
// itself), so the answer is kept by the CDN for a few minutes: a burst of
// previews of one shared link costs one drawing, and a corrected release
// year or time shows within five minutes. A card that names a film is
// never kept past the show's start or past midnight Central on Jan 1, when
// this year's films become last year's (MPLC).
export const dynamic = "force-dynamic";
export const alt = "A showtime at Royale Cinema Lounge, Joplin, MO";
export const size = SHARE_SIZE;
export const contentType = "image/png";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_SECONDS = 300;

// Shared caches may keep the card CACHE_SECONDS, or until `until` (ms) if
// that's sooner. No stale-while-revalidate: nothing is served past it.
function cacheFor(until = Infinity) {
  const seconds = Math.floor(Math.min(CACHE_SECONDS * 1000, until - Date.now()) / 1000);
  return { "Cache-Control": seconds > 0 ? `public, max-age=0, s-maxage=${seconds}` : "no-store" };
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { fonts, logo } = await loadShareAssets();

  const { data } = UUID.test(id)
    ? await createAdminClient().from("screenings").select("starts_at, movie:movies(title, poster_url, release_year)").eq("id", id).maybeSingle()
    : { data: null };
  const screening = data as { starts_at: string; movie: { title: string; poster_url: string | null; release_year: number | null } | null } | null;

  if (!screening?.movie || !isWithinPublicWindow(screening.starts_at) || isRestrictedRelease(screening.movie)) {
    return new ImageResponse(<BrandCard logo={logo} photo={null} />, { ...SHARE_SIZE, fonts, headers: cacheFor() });
  }

  const start = new Date(screening.starts_at);
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
  const time = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  const poster = await fetchPoster(screening.movie.poster_url);
  const headers = cacheFor(Math.min(start.getTime(), nextCentralYearStart()));
  return new ImageResponse(<ShowtimeCard logo={logo} poster={poster} title={screening.movie.title} when={`${day} · ${time}`} />, { ...SHARE_SIZE, fonts, headers });
}
