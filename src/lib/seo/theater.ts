import {
  DIRECTIONS_URL,
  OPENING_HOURS_TODO,
  SITE_NAME,
  SITE_URL,
  SOCIAL_PROFILES,
  THEATER_ADDRESS,
  THEATER_EMAIL,
  THEATER_PHONE,
} from "@/lib/site";

// schema.org MovieTheater markup for the theater itself, on every public
// page (the site chrome renders it). The @id names this one place, so each
// showtime's ScreeningEvent can point at it instead of describing a second,
// slightly different theater.
export const THEATER_ID = `${SITE_URL}/#theater`;

// Left out on purpose, until they're known:
// - geo: no coordinates are recorded anywhere in the app, and guessed ones
//   would put the pin on the wrong building. The street address is enough
//   for Google to place it.
// - openingHoursSpecification: see OPENING_HOURS_TODO in lib/site.ts.
// - sameAs: see SOCIAL_PROFILES in lib/site.ts.
export function theaterJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "MovieTheater",
    "@id": THEATER_ID,
    name: SITE_NAME,
    description: "A cinema, bar, and members' lounge showing independent and repertory film in a historic 1920 building on Route 66.",
    url: SITE_URL,
    telephone: THEATER_PHONE,
    email: THEATER_EMAIL,
    priceRange: "$$",
    image: `${SITE_URL}/opengraph-image`,
    logo: `${SITE_URL}/brand-logo.png`,
    address: THEATER_ADDRESS,
    hasMap: DIRECTIONS_URL,
    ...(SOCIAL_PROFILES.length > 0 && { sameAs: SOCIAL_PROFILES }),
    ...(OPENING_HOURS_TODO.length > 0 && {
      openingHoursSpecification: OPENING_HOURS_TODO.map((h) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: h.days.map((d) => `https://schema.org/${d}`),
        opens: h.opens,
        closes: h.closes,
      })),
    }),
  };
}

// A ScreeningEvent's location: the theater above, by reference, with the
// name and address repeated for readers that don't follow @id links.
export const THEATER_REF = {
  "@type": "MovieTheater",
  "@id": THEATER_ID,
  name: SITE_NAME,
  url: SITE_URL,
  address: THEATER_ADDRESS,
} as const;
