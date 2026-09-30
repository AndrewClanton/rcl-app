// The stretches of business days Reports looks at: a week (Monday to
// Sunday), a film week (Friday to Thursday, how distributors count a
// movie's week), a month, or any dates. Dates are "YYYY-MM-DD" business
// dates (4 a.m. to 4 a.m. Central, src/lib/ops/time.ts); a period's end is
// its last day, included. Plain date arithmetic, no clock or time zone, so
// it works the same on the server and in the browser.

export type PeriodKind = "week" | "film" | "month" | "custom";

export interface Period {
  kind: PeriodKind;
  start: string; // first business date
  end: string; // last business date, included
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isDate(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isMonth(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 0 = Sunday ... 6 = Saturday.
export function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function daysBetween(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000);
}

// Every date from start to end, included.
export function datesIn(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekOf(date: string): Period {
  const start = addDays(date, -((weekday(date) + 6) % 7)); // back to Monday
  return { kind: "week", start, end: addDays(start, 6) };
}

export function filmWeekOf(date: string): Period {
  const start = addDays(date, -((weekday(date) + 2) % 7)); // back to Friday
  return { kind: "film", start, end: addDays(start, 6) };
}

export function monthOf(month: string): Period {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { kind: "month", start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

// The same kind of period, n before (negative) or after.
export function shiftPeriod(p: Period, n: number): Period {
  if (p.kind === "month") return monthOf(shiftMonth(p.start.slice(0, 7), n));
  if (p.kind === "custom") {
    const len = daysBetween(p.start, p.end) + 1;
    return { kind: "custom", start: addDays(p.start, n * len), end: addDays(p.end, n * len) };
  }
  return { ...p, start: addDays(p.start, 7 * n), end: addDays(p.end, 7 * n) };
}

// "Sep 28", "Sep 28, 2026", "Mon Sep 28"
export function shortDate(date: string, opts: { year?: boolean; weekday?: boolean } = {}) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.year ? { year: "numeric" } : {}),
    ...(opts.weekday ? { weekday: "short" } : {}),
    timeZone: "UTC",
  });
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// "Sep 28 – Oct 4, 2026" (the year once, or on both ends when it changes).
export function rangeLabel(start: string, end: string, opts: { weekday?: boolean } = {}) {
  if (start === end) return shortDate(start, { year: true, weekday: opts.weekday });
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${shortDate(start, { year: !sameYear, weekday: opts.weekday })} – ${shortDate(end, { year: true, weekday: opts.weekday })}`;
}

export function periodLabel(p: Period) {
  if (p.kind === "month") return monthLabel(p.start.slice(0, 7));
  return rangeLabel(p.start, p.end, { weekday: p.kind === "film" });
}
