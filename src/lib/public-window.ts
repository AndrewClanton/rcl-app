// How far ahead showtimes are public, and whether one is public right now.
// Its own module (no server-only imports) so the proxy can use it too: it
// answers an expired showtime link with the real 404 page before the
// showtime page renders (see lib/showtime-gate.ts).
//
// The window is today's business day plus the next six: it ends at 4 a.m.
// Central (the business-day rollover, lib/ops/time.ts) seven business days
// from now. The schedule further out is rarely firm, so it isn't listed --
// not on the site, the sitemap, the lobby TV or for online tickets.
export const PUBLIC_SCHEDULE_WINDOW_DAYS = 7;

const TZ = "America/Chicago";
const DAY_STARTS_AT_HOUR = 4;

function centralParts(t: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// The instant the public window closes: 4 a.m. Central on the business date
// PUBLIC_SCHEDULE_WINDOW_DAYS after today's. DST-aware.
export function publicWindowEnd(now = Date.now()): number {
  const today = centralParts(now - DAY_STARTS_AT_HOUR * 3_600_000).date;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + PUBLIC_SCHEDULE_WINDOW_DAYS);
  let t = new Date(`${d.toISOString().slice(0, 10)}T09:00:00Z`).getTime(); // 4 a.m. CDT
  const hour = centralParts(t).hour;
  if (hour !== DAY_STARTS_AT_HOUR) t += (DAY_STARTS_AT_HOUR - hour) * 3_600_000; // CST: 10:00Z
  return t;
}

// Whether a screening's start time falls inside the public visibility
// window -- used to gate a direct link to a not-yet-public screening's own
// detail/booking page, not just the listing pages.
export function isWithinPublicWindow(startsAt: string): boolean {
  const start = new Date(startsAt).getTime();
  const now = Date.now();
  return start >= now && start < publicWindowEnd(now);
}
