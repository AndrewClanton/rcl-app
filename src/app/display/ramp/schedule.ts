// Which film the ramp TV shows at a given moment. Pure (no React, no
// fetching) so the page and the client component share one definition.

// How long a film stays on screen after it starts, for latecomers walking
// up the ramp, before the TV moves on to the next one.
export const NOW_PLAYING_MINUTES = 20;

export const CENTRAL_TZ = "America/Chicago";

export interface RampScreening {
  id: string;
  startsAt: number; // epoch ms
  title: string;
  posterUrl: string | null;
  rating: string | null;
  runtimeMinutes: number | null;
  room: string;
}

export type RampState =
  | { kind: "empty" }
  | { kind: "countdown" | "now-playing"; featured: RampScreening[]; later: RampScreening[]; laterLabel: string };

function centralDateKey(ms: number) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function weekday(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { timeZone: CENTRAL_TZ, weekday: "long" }).toUpperCase();
}

export function rampStateAt(screenings: RampScreening[], now: number): RampState {
  const grace = NOW_PLAYING_MINUTES * 60 * 1000;
  const active = screenings.filter((s) => now < s.startsAt + grace).sort((a, b) => a.startsAt - b.startsAt);
  if (active.length === 0) return { kind: "empty" };

  // Films starting at the same moment (e.g. indoor + patio) are shown together.
  const first = active[0].startsAt;
  const featured = active.filter((s) => s.startsAt === first);
  const day = centralDateKey(first);
  const later = active.filter((s) => s.startsAt > first && centralDateKey(s.startsAt) === day).slice(0, 3);
  const laterLabel = day === centralDateKey(now) ? "LATER TODAY" : `ALSO ${weekday(first)}`;

  return { kind: now >= first ? "now-playing" : "countdown", featured, later, laterLabel };
}

// "12:47" under an hour, "3:12:47" under a day, null beyond that (the
// caller shows the day and time instead of a day-plus countdown).
export function formatCountdown(ms: number): string | null {
  if (ms >= 24 * 60 * 60 * 1000) return null;
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: CENTRAL_TZ, hour: "numeric", minute: "2-digit" });
}

export function formatDayTime(ms: number) {
  const day = new Date(ms).toLocaleDateString("en-US", { timeZone: CENTRAL_TZ, weekday: "short" }).toUpperCase();
  return `${day} ${formatClock(ms)}`;
}
