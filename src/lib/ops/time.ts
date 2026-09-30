// Plain date math with no server imports, so the lobby TV's board can use
// it in the browser too. Called there, pass the server's clock as `now`: a
// TV stick's own clock can be off.

const TZ = "America/Chicago";

// The business day rolls over at 4 a.m. Central, not midnight, so a closing
// shift that runs past 12 still ticks off *tonight's* closing tasks.
const DAY_STARTS_AT_HOUR = 4;

let partsFormat: Intl.DateTimeFormat | null = null;

// The wall clock in Joplin at an instant, CDT or CST as it was then.
function parts(d: Date) {
  partsFormat ??= new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(partsFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

// The instant (epoch ms) a Central wall-clock time happens. A time the clocks
// skip (2:30 a.m. the night they spring forward) comes out an hour later; one
// they repeat (1:30 a.m. the night they fall back) is the first, in CDT.
function centralMs(date: string, minutes: number) {
  const want = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000; // the wall clock, read as if it were UTC
  const t = want + 5 * 3_600_000; // as if CDT
  const p = parts(new Date(t));
  const got = Date.parse(`${p.date}T00:00:00Z`) + (p.hour * 60 + p.minute) * 60_000;
  return t + want - got; // CST is an hour further from UTC
}

// The business day an instant belongs to: its date on the Central wall
// clock, or the day before if the clock reads earlier than 4 a.m. By the
// wall clock, not by subtracting four hours, so the nights the clocks change
// roll over at 4 a.m. too.
export function businessDay(now = new Date()) {
  const p = parts(now);
  const date = p.hour < DAY_STARTS_AT_HOUR ? shiftDate(p.date, -1) : p.date;
  return { date, dow: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

// The instants a business date covers: 4 a.m. Central that day until 4 a.m.
// the next, as ISO strings for database range queries. DST-aware: the day
// before the clocks spring forward is 23 hours, the one they fall back 25.
export function businessDayWindow(date: string) {
  const fourAm = (d: string) => new Date(centralMs(d, DAY_STARTS_AT_HOUR * 60)).toISOString();
  return { start: fourAm(date), end: fourAm(shiftDate(date, 1)) };
}

// A Central wall-clock date and time ("2026-10-13", "19:00") as an ISO
// instant, whichever of CDT/CST applies that day.
export function centralToIso(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(centralMs(date, h * 60 + m)).toISOString();
}

// The business date `days` before/after a "YYYY-MM-DD" date.
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Minutes since midnight Central, right now.
export function centralMinutes(now = new Date()) {
  const p = parts(now);
  return p.hour * 60 + p.minute;
}

export function centralDate(now = new Date()) {
  return parts(now).date;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
}

// "YYYY-MM-DD" business dates for the last `n` days, newest first. By the
// calendar, not 24-hour steps back, which skip or repeat a day around the
// nights the clocks change.
export function recentBusinessDays(n: number, now = new Date()) {
  const today = businessDay(now).date;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(shiftDate(today, -i));
  return out;
}
