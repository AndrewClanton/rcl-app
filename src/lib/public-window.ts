// How far ahead showtimes are public, and whether one is public right now.
// Its own module (no server-only imports) so the proxy can use it too: it
// answers an expired showtime link with the real 404 page before the
// showtime page renders (see lib/showtime-gate.ts).
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
