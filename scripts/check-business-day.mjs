// Checks the business day in src/lib/ops/time.ts (4 a.m. to 4 a.m. Central):
//  1. Normal days, in daylight and standard time: 11:59 PM, midnight, 3:59
//     vs 4:00 AM, and the window each business date covers.
//  2. The night the clocks spring forward (Sun Mar 8, 2026) and the night
//     they fall back (Sun Nov 1, 2026): the day still rolls over at 4:00 on
//     the wall clock, and those business days are 23 and 25 hours long.
//  3. Year boundaries (and Feb 29) for businessDay, businessDayWindow,
//     shiftDate and recentBusinessDays, and recentBusinessDays across the
//     change nights.
//  4. centralToIso: the small hours in standard time, and the times the
//     clocks skip or repeat.
//  5. Every 15 minutes of 2026 (every minute of the two change nights): the
//     business day's window holds the moment, starts at 4:00 on the wall
//     clock, and ends where the next day's starts.
//
// Usage: node scripts/check-business-day.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

// "server-only" (which throws outside Next's server build) is a no-op here.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s, c);
      }`,
    ),
);

const { businessDay, businessDayWindow, centralToIso, recentBusinessDays, shiftDate } = await import("../src/lib/ops/time.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Central is UTC-5 in daylight time (CDT), UTC-6 in standard time (CST).
const cdt = (date, time) => new Date(`${date}T${time}:00-05:00`);
const cst = (date, time) => new Date(`${date}T${time}:00-06:00`);
const day = (at) => businessDay(at).date;
const hours = (w) => (Date.parse(w.end) - Date.parse(w.start)) / 3_600_000;
const SUN = 0, MON = 1, WED = 3, THU = 4, FRI = 5, SAT = 6;

// ---------- 1. normal days ----------
eq("Fri Oct 2, 7 PM CDT", businessDay(cdt("2026-10-02", "19:00")), { date: "2026-10-02", dow: FRI });
eq("Thu Jan 15, noon CST", businessDay(cst("2026-01-15", "12:00")), { date: "2026-01-15", dow: THU });
eq("11:59 PM Friday is Friday", day(cdt("2026-10-02", "23:59")), "2026-10-02");
eq("midnight Saturday is still Friday", businessDay(cdt("2026-10-03", "00:00")), { date: "2026-10-02", dow: FRI });
eq("3:59 AM Saturday is still Friday", businessDay(cdt("2026-10-03", "03:59")), { date: "2026-10-02", dow: FRI });
eq("3:59:59.999 AM too", day(new Date("2026-10-03T03:59:59.999-05:00")), "2026-10-02");
eq("4:00 AM Saturday is Saturday", businessDay(cdt("2026-10-03", "04:00")), { date: "2026-10-03", dow: SAT });
eq("CST: 3:59 AM Friday is Thursday", day(cst("2026-01-16", "03:59")), "2026-01-15");
eq("CST: 4:00 AM Friday is Friday", day(cst("2026-01-16", "04:00")), "2026-01-16");
eq("the default is now", businessDay(), businessDay(new Date()));
eq("a CDT day's window is 4 AM to 4 AM", businessDayWindow("2026-10-02"), { start: "2026-10-02T09:00:00.000Z", end: "2026-10-03T09:00:00.000Z" });
eq("a CST day's window is 4 AM to 4 AM", businessDayWindow("2026-01-15"), { start: "2026-01-15T10:00:00.000Z", end: "2026-01-16T10:00:00.000Z" });

// ---------- 2. the nights the clocks change ----------
// Spring forward: Sunday Mar 8, 2026, 2:00 AM CST becomes 3:00 AM CDT.
eq("spring: 11:30 PM Saturday is Saturday", businessDay(cst("2026-03-07", "23:30")), { date: "2026-03-07", dow: SAT });
eq("spring: 1:59 AM CST is Saturday's", day(cst("2026-03-08", "01:59")), "2026-03-07");
eq("spring: 3:00 AM CDT (a minute later) too", day(cdt("2026-03-08", "03:00")), "2026-03-07");
eq("spring: 3:59 AM CDT too", day(cdt("2026-03-08", "03:59")), "2026-03-07");
eq("spring: 4:00 AM CDT starts Sunday (minus-four-hours said Saturday)", businessDay(cdt("2026-03-08", "04:00")), { date: "2026-03-08", dow: SUN });
eq("spring: 4:59 AM CDT is Sunday (minus-four-hours said Saturday)", day(cdt("2026-03-08", "04:59")), "2026-03-08");
eq("spring: 5:00 AM CDT is Sunday", day(cdt("2026-03-08", "05:00")), "2026-03-08");
eq("spring: 3:59 AM Monday is Sunday's", day(cdt("2026-03-09", "03:59")), "2026-03-08");
eq("spring: 4:00 AM Monday is Monday", businessDay(cdt("2026-03-09", "04:00")), { date: "2026-03-09", dow: MON });
{
  const sat = businessDayWindow("2026-03-07");
  eq("spring: Saturday runs 4 AM CST to 4 AM CDT", sat, { start: "2026-03-07T10:00:00.000Z", end: "2026-03-08T09:00:00.000Z" });
  eq("  23 hours", hours(sat), 23);
  eq("spring: Sunday runs 4 AM CDT to 4 AM CDT", businessDayWindow("2026-03-08"), { start: "2026-03-08T09:00:00.000Z", end: "2026-03-09T09:00:00.000Z" });
}

// Fall back: Sunday Nov 1, 2026, 2:00 AM CDT becomes 1:00 AM CST.
eq("fall: 1:30 AM CDT (the first one) is Saturday's", businessDay(cdt("2026-11-01", "01:30")), { date: "2026-10-31", dow: SAT });
eq("fall: 1:30 AM CST (the second one) too", day(cst("2026-11-01", "01:30")), "2026-10-31");
eq("fall: 3:00 AM CST is Saturday's (minus-four-hours said Sunday)", day(cst("2026-11-01", "03:00")), "2026-10-31");
eq("fall: 3:59 AM CST is Saturday's (minus-four-hours said Sunday)", day(cst("2026-11-01", "03:59")), "2026-10-31");
eq("fall: 4:00 AM CST starts Sunday", businessDay(cst("2026-11-01", "04:00")), { date: "2026-11-01", dow: SUN });
eq("fall: 3:59 AM Monday is Sunday's", day(cst("2026-11-02", "03:59")), "2026-11-01");
eq("fall: 4:00 AM Monday is Monday", day(cst("2026-11-02", "04:00")), "2026-11-02");
{
  const sat = businessDayWindow("2026-10-31");
  eq("fall: Saturday runs 4 AM CDT to 4 AM CST", sat, { start: "2026-10-31T09:00:00.000Z", end: "2026-11-01T10:00:00.000Z" });
  eq("  25 hours", hours(sat), 25);
  eq("fall: Sunday runs 4 AM CST to 4 AM CST", businessDayWindow("2026-11-01"), { start: "2026-11-01T10:00:00.000Z", end: "2026-11-02T10:00:00.000Z" });
}

// ---------- 3. year boundaries ----------
eq("11:30 PM New Year's Eve is Dec 31", businessDay(cst("2026-12-31", "23:30")), { date: "2026-12-31", dow: THU });
eq("midnight Jan 1 is still Dec 31", day(cst("2027-01-01", "00:00")), "2026-12-31");
eq("3:59 AM Jan 1 is still Dec 31", day(cst("2027-01-01", "03:59")), "2026-12-31");
eq("4:00 AM Jan 1 is Jan 1", businessDay(cst("2027-01-01", "04:00")), { date: "2027-01-01", dow: FRI });
eq("1 AM Jan 1, 2026 is Dec 31, 2025", businessDay(cst("2026-01-01", "01:00")), { date: "2025-12-31", dow: WED });
eq("Dec 31's window runs into the new year", businessDayWindow("2026-12-31"), { start: "2026-12-31T10:00:00.000Z", end: "2027-01-01T10:00:00.000Z" });
eq("shiftDate: Dec 31 + 1", shiftDate("2026-12-31", 1), "2027-01-01");
eq("shiftDate: Jan 1 - 1", shiftDate("2027-01-01", -1), "2026-12-31");
eq("shiftDate: Jan 1 - 365", shiftDate("2027-01-01", -365), "2026-01-01");
eq("shiftDate: Feb 28 + 1 in a leap year", shiftDate("2028-02-28", 1), "2028-02-29");
eq("shiftDate: Mar 1 - 1 in a leap year", shiftDate("2028-03-01", -1), "2028-02-29");
eq("shiftDate: Mar 1 - 1 otherwise", shiftDate("2026-03-01", -1), "2026-02-28");
eq("shiftDate: across spring forward", shiftDate("2026-03-07", 2), "2026-03-09");
eq("shiftDate: across fall back", shiftDate("2026-11-02", -2), "2026-10-31");
eq("recentBusinessDays at 3 AM Jan 1", recentBusinessDays(3, cst("2027-01-01", "03:00")), ["2026-12-31", "2026-12-30", "2026-12-29"]);
eq("recentBusinessDays at 4 AM Jan 1", recentBusinessDays(3, cst("2027-01-01", "04:00")), ["2027-01-01", "2026-12-31", "2026-12-30"]);
eq("recentBusinessDays across spring forward skips nothing", recentBusinessDays(4, cdt("2026-03-09", "04:30")), ["2026-03-09", "2026-03-08", "2026-03-07", "2026-03-06"]);
eq("recentBusinessDays across fall back repeats nothing", recentBusinessDays(3, cst("2026-11-02", "03:30")), ["2026-11-01", "2026-10-31", "2026-10-30"]);
eq("recentBusinessDays(0) is empty", recentBusinessDays(0, cdt("2026-10-02", "12:00")), []);

// ---------- 4. centralToIso ----------
eq("7 PM CDT", centralToIso("2026-10-13", "19:00"), "2026-10-14T00:00:00.000Z");
eq("7 PM CST", centralToIso("2026-01-10", "19:00"), "2026-01-11T01:00:00.000Z");
eq("12:30 AM CST is that day, not the day before", centralToIso("2026-01-10", "00:30"), "2026-01-10T06:30:00.000Z");
eq("11:59 PM CST", centralToIso("2026-01-10", "23:59"), "2026-01-11T05:59:00.000Z");
eq("4:00 AM CST", centralToIso("2026-01-10", "04:00"), "2026-01-10T10:00:00.000Z");
eq("spring: 12:30 AM (CST)", centralToIso("2026-03-08", "00:30"), "2026-03-08T06:30:00.000Z");
eq("spring: 1:30 AM (CST)", centralToIso("2026-03-08", "01:30"), "2026-03-08T07:30:00.000Z");
eq("spring: 2:30 AM (skipped) comes out 3:30 CDT", centralToIso("2026-03-08", "02:30"), "2026-03-08T08:30:00.000Z");
eq("spring: 3:30 AM CDT", centralToIso("2026-03-08", "03:30"), "2026-03-08T08:30:00.000Z");
eq("fall: 12:30 AM (CDT)", centralToIso("2026-11-01", "00:30"), "2026-11-01T05:30:00.000Z");
eq("fall: 1:30 AM (twice) is the first, CDT", centralToIso("2026-11-01", "01:30"), "2026-11-01T06:30:00.000Z");
eq("fall: 2:30 AM CST", centralToIso("2026-11-01", "02:30"), "2026-11-01T08:30:00.000Z");
eq("Dec 31, 11 PM CST", centralToIso("2026-12-31", "23:00"), "2027-01-01T05:00:00.000Z");

// ---------- 5. every moment of 2026 ----------
{
  const wall = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const moments = [];
  for (let t = Date.parse("2026-01-01T06:00:00Z"); t < Date.parse("2027-01-01T10:00:00Z"); t += 15 * 60_000) moments.push(t);
  for (const night of ["2026-03-08T05:00:00Z", "2026-11-01T05:00:00Z"]) {
    for (let t = Date.parse(night); t < Date.parse(night) + 7 * 3_600_000; t += 60_000) moments.push(t);
  }
  const misses = { window: [], weekday: [] };
  for (const t of moments) {
    const { date, dow } = businessDay(new Date(t));
    const w = businessDayWindow(date);
    if (!(Date.parse(w.start) <= t && t < Date.parse(w.end))) misses.window.push(new Date(t).toISOString());
    if (wall.formatToParts(new Date(w.start)).find((x) => x.type === "weekday").value !== WEEKDAYS[dow]) misses.weekday.push(new Date(t).toISOString());
  }
  check(`each of ${moments.length} moments falls in its business day's window`, !misses.window.length, misses.window.slice(0, 3).join(", "));
  check("  and dow is that day's weekday", !misses.weekday.length, misses.weekday.slice(0, 3).join(", "));

  const bad = { start: [], seam: [], length: [] };
  for (let d = "2026-01-01"; d <= "2026-12-31"; d = shiftDate(d, 1)) {
    const w = businessDayWindow(d);
    const clockAt = Object.fromEntries(wall.formatToParts(new Date(w.start)).map((x) => [x.type, x.value]));
    if (`${clockAt.hour}:${clockAt.minute}` !== "04:00") bad.start.push(d);
    if (w.end !== businessDayWindow(shiftDate(d, 1)).start) bad.seam.push(d);
    if (hours(w) !== (d === "2026-03-07" ? 23 : d === "2026-10-31" ? 25 : 24)) bad.length.push(`${d}: ${hours(w)}h`);
  }
  check("every 2026 window starts at 4:00 AM on the wall clock", !bad.start.length, bad.start.slice(0, 3).join(", "));
  check("  and ends where the next day's starts", !bad.seam.length, bad.seam.slice(0, 3).join(", "));
  check("  and is 24 hours, but for Mar 7 (23) and Oct 31 (25)", !bad.length.length, bad.length.slice(0, 3).join(", "));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll business-day checks passed.");
process.exit(failures ? 1 : 0);
