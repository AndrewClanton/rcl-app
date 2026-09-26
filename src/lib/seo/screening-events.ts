import { isRestrictedRelease } from "@/lib/mplc";
import { SITE_NAME, SITE_URL, THEATER_ADDRESS } from "@/lib/site";
import type { Screening } from "@/lib/types";

// schema.org ScreeningEvent markup for a showtime, so search engines can read
// the movie, time, place and price straight off the page instead of guessing
// from the layout.
//
// MPLC: an older title must never be advertised publicly (see mplc.ts), and
// structured data is the most machine-readable advertising there is. So this
// returns null for a restricted title even if a caller forgets to filter --
// fail closed, same as the rest of the site.
export function screeningEventJsonLd(s: Screening, seatsLeft?: number): Record<string, unknown> | null {
  if (isRestrictedRelease(s.movie)) return null;
  const url = `${SITE_URL}/showtimes/${s.id}`;
  const start = new Date(s.starts_at);
  const end = s.movie.runtime_minutes ? new Date(start.getTime() + s.movie.runtime_minutes * 60_000) : null;
  return {
    "@context": "https://schema.org",
    "@type": "ScreeningEvent",
    name: s.movie.title,
    url,
    startDate: start.toISOString(),
    ...(end && { endDate: end.toISOString() }),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(s.movie.poster_url && { image: s.movie.poster_url }),
    ...(s.movie.synopsis && { description: s.movie.synopsis }),
    location: {
      "@type": "MovieTheater",
      name: SITE_NAME,
      url: SITE_URL,
      address: THEATER_ADDRESS,
    },
    workPresented: {
      "@type": "Movie",
      name: s.movie.title,
      ...(s.movie.poster_url && { image: s.movie.poster_url }),
      ...(s.movie.runtime_minutes && { duration: `PT${s.movie.runtime_minutes}M` }),
      ...(s.movie.rating && { contentRating: s.movie.rating }),
      ...(s.movie.release_year && { dateCreated: String(s.movie.release_year) }),
    },
    offers: {
      "@type": "Offer",
      url,
      price: s.ticket_price.toFixed(2),
      priceCurrency: "USD",
      ...(seatsLeft !== undefined && {
        availability: seatsLeft > 0 ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      }),
    },
  };
}

// For a <script type="application/ld+json">. Escapes "<" so a title or
// synopsis containing "</script>" can't break out of the tag.
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
