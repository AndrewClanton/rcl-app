// The days Royale Cinema is closed to the public, by its own clock
// (America/Chicago). 0 = Sunday ... 6 = Saturday. The public booking forms
// and their server actions refuse these days (lib/closed-days-server.ts);
// staff screens don't, so a private event can still go on a closed day.
// No server-only: the date pickers use it too.
export const CLOSED_WEEKDAYS: readonly number[] = [0];

// The short line beside every public date picker. Keep it in step with
// CLOSED_WEEKDAYS.
export const CLOSED_DAYS_NOTE = "We're closed Sundays.";

const TZ = "America/Chicago";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Midday Central on a "YYYY-MM-DD" date (18:00Z is noon CST, 1 PM CDT), so
// the date never slips a day whichever of CST/CDT applies.
function midday(date: string) {
  return new Date(`${date}T18:00:00Z`);
}

function central(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, dow: WEEKDAYS.indexOf(p.weekday) };
}

// Is this business date ("YYYY-MM-DD", Central) one we're closed? Anything
// that isn't a real date answers false; callers check the format first.
export function isClosedDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = midday(date);
  if (Number.isNaN(d.getTime())) return false;
  const c = central(d);
  return c.date === date && CLOSED_WEEKDAYS.includes(c.dow);
}

// The first open date on or after `date`: what a date picker starts on.
export function nextOpenDate(date: string): string {
  const start = midday(date);
  if (Number.isNaN(start.getTime())) return date;
  for (let i = 0; i < 7; i++) {
    const d = central(new Date(start.getTime() + i * 86_400_000)).date;
    if (!isClosedDate(d)) return d;
  }
  return date;
}
