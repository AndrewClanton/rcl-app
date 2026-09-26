// Single source of truth for the site's public URL and name, used by
// metadata, robots.ts, sitemap.ts, and structured data. Update SITE_URL if
// the app moves to a custom domain (e.g. royalecinemajoplin.com).
export const SITE_URL = "https://rcl-app.vercel.app";
export const SITE_NAME = "Royale Cinema Lounge";

// The theater's street address, as schema.org structured data. Shared by the
// site-wide MovieTheater listing and each showtime's ScreeningEvent, so Google
// sees one consistent place.
export const THEATER_ADDRESS = {
  "@type": "PostalAddress",
  streetAddress: "715 E Broadway",
  addressLocality: "Joplin",
  addressRegion: "MO",
  postalCode: "64801",
  addressCountry: "US",
} as const;
