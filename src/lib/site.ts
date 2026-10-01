// Single source of truth for the site's public URL and name, used by
// metadata (lib/seo/page-meta.ts), robots.ts, sitemap.ts, and structured
// data. Update SITE_URL if the app moves to a custom domain (e.g.
// royalecinemajoplin.com): canonicals, link previews and JSON-LD all follow.
export const SITE_URL = "https://rcl-app.vercel.app";
export const SITE_NAME = "Royale Cinema Lounge";

// The one-sentence pitch: the home page's description and the fallback for
// any page that doesn't have its own.
export const SITE_DESCRIPTION =
  "A dine-in cinema, bar and members' lounge in a historic 1920 building on Route 66 in Joplin, MO: independent and repertory film, a full food and drink menu, and a VHS video lounge.";

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

export const THEATER_PHONE = "+1-417-281-4172";
export const THEATER_EMAIL = "info@royalecinemajoplin.com";
export const DIRECTIONS_URL = "https://www.google.com/maps/search/?api=1&query=715+E+Broadway,+Joplin,+MO+64801";

// Our social profiles, for structured data (schema.org sameAs). None are
// recorded anywhere in the app yet.
// TODO(Andrew): add the full profile URLs, e.g. "https://www.facebook.com/<page>"
// and "https://www.instagram.com/<handle>".
export const SOCIAL_PROFILES: string[] = [];

// Regular opening hours, for structured data (openingHoursSpecification).
// Deliberately empty: nobody has written the hours down here, and made-up
// hours are worse than none (Google would show them as fact).
// TODO(Andrew): fill in the real hours, one line per set of days, 24-hour
// "HH:MM" Central, e.g. { days: ["Friday", "Saturday"], opens: "16:00", closes: "23:30" }.
// A night that runs past midnight closes on the next day's clock ("01:00").
export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
export const OPENING_HOURS_TODO: { days: Weekday[]; opens: string; closes: string }[] = [];
