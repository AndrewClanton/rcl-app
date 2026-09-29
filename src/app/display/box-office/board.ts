// What the lobby box-office TV shows at a given moment. Pure (no React, no
// fetching, no server imports) so the page and the client component share
// one definition. Every date and time is Central.

export const CENTRAL_TZ = "America/Chicago";

// A showing stays in the hero, tagged NOW SHOWING, this long after it
// starts (for latecomers), then the board moves on to the next one.
export const NOW_SHOWING_MINUTES = 20;

// Rows under the hero -- as many as stay big enough to read across the lobby.
export const MAX_ROWS = 4;

// The business day rolls over at 4 AM Central (as in lib/ops/time.ts), so a
// show at 12:30 AM still reads as "Tonight".
const DAY_STARTS_AT_HOUR = 4;

// Only what the screen shows -- no ticket counts, revenue or notes, since
// this page is public.
export interface BoardShow {
  id: string;
  title: string;
  startsAt: number; // epoch ms
  room: string;
  rating: string | null;
  runtimeMinutes: number | null;
  posterUrl: string | null;
}

export interface BoardState {
  hero: BoardShow | null;
  nowShowing: boolean;
  rows: BoardShow[];
}

export function boardAt(shows: BoardShow[], now: number): BoardState {
  const grace = NOW_SHOWING_MINUTES * 60_000;
  const active = shows.filter((s) => now < s.startsAt + grace).sort((a, b) => a.startsAt - b.startsAt);
  if (active.length === 0) return { hero: null, nowShowing: false, rows: [] };
  return { hero: active[0], nowShowing: now >= active[0].startsAt, rows: active.slice(1, 1 + MAX_ROWS) };
}

// "Indoor Cinema (includes West Hall if needed)" -> "Indoor Cinema";
// "Outdoor Cinema — patio, weather dependent" -> "Outdoor Cinema".
export function shortRoom(name: string) {
  return name.split(" — ")[0].replace(/\s*\(.*\)\s*$/, "").trim() || name;
}

function businessDateKey(ms: number) {
  return new Date(ms - DAY_STARTS_AT_HOUR * 3_600_000).toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function centralHour(ms: number) {
  return Number(new Date(ms).toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: CENTRAL_TZ }));
}

// "Tonight" / "Today" / "Tomorrow", else the day: "Fri 10/2" (short) or
// "Friday, Oct 2" (long).
export function dayLabel(ms: number, now: number, long = false) {
  const key = businessDateKey(ms);
  if (key === businessDateKey(now)) {
    const h = centralHour(ms);
    return h >= 17 || h < DAY_STARTS_AT_HOUR ? "Tonight" : "Today";
  }
  if (key === businessDateKey(now + 86_400_000)) return "Tomorrow";
  const noon = new Date(`${key}T12:00:00Z`);
  if (long) return noon.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  const wd = noon.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${noon.getUTCMonth() + 1}/${noon.getUTCDate()}`;
}

export function clock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: CENTRAL_TZ });
}

export function longDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: CENTRAL_TZ });
}

// "Starts in 42 min" / "Started 7 min ago" -- only when it's close enough
// to matter; null otherwise (the day and time say it).
export function startsLabel(startsAt: number, now: number) {
  const mins = Math.round((startsAt - now) / 60_000);
  if (now >= startsAt) {
    const ago = Math.floor((now - startsAt) / 60_000);
    return ago < 1 ? "Just started" : `Started ${ago} min ago`;
  }
  if (mins <= 1) return "Starting now";
  if (mins < 60) return `Starts in ${mins} min`;
  if (mins < 180) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `Starts in ${h} hr ${m} min` : `Starts in ${h} hr`;
  }
  return null;
}
