import "server-only";

const TZ = "America/Chicago";

// The business day rolls over at 4 a.m. Central, not midnight, so a closing
// shift that runs past 12 still ticks off *tonight's* closing tasks.
const DAY_STARTS_AT_HOUR = 4;

function parts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday as string };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function businessDay(now = new Date()) {
  const shifted = new Date(now.getTime() - DAY_STARTS_AT_HOUR * 3_600_000);
  const p = parts(shifted);
  return { date: p.date, dow: WEEKDAYS.indexOf(p.weekday) };
}

// The instants a business date covers: 4 a.m. Central that day until 4 a.m.
// the next, as ISO strings for database range queries. DST-aware.
export function businessDayWindow(date: string) {
  const fourAm = (d: string) => {
    let t = new Date(`${d}T09:00:00Z`).getTime(); // 4 a.m. CDT
    const hour = parts(new Date(t)).hour;
    if (hour !== DAY_STARTS_AT_HOUR) t += (DAY_STARTS_AT_HOUR - hour) * 3_600_000; // CST: 10:00Z
    return new Date(t).toISOString();
  };
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: fourAm(date), end: fourAm(next.toISOString().slice(0, 10)) };
}

// A Central wall-clock date and time ("2026-10-13", "19:00") as an ISO
// instant, whichever of CDT/CST applies that day.
export function centralToIso(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  let t = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`).getTime() + 5 * 3_600_000; // as if CDT
  const p = parts(new Date(t));
  if (p.hour !== h) t += (h - p.hour) * 3_600_000; // CST is an hour further from UTC
  return new Date(t).toISOString();
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

// "YYYY-MM-DD" business dates for the last `n` days, newest first.
export function recentBusinessDays(n: number, now = new Date()) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(businessDay(new Date(now.getTime() - i * 86_400_000)).date);
  return out;
}
