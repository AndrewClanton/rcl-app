// Checks the closed-days rule (src/lib/closed-days.ts and
// closed-days-server.ts) without a database or the network: Sundays are
// refused by the Royale's own clock (America/Chicago, business day rolling
// over at 4 a.m.), never by UTC or the machine's zone. Covers late Saturday
// and early Sunday, Sunday night after midnight, and both DST switches.
//
// Usage: node scripts/check-closed-days.mjs   (Node 23.6+ runs the .ts directly)
// Run it under another zone too, e.g. TZ=Asia/Tokyo, to see it doesn't move.
import { register } from "node:module";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);
const { CLOSED_WEEKDAYS, CLOSED_DAYS_NOTE, isClosedDate, nextOpenDate } = await import("../src/lib/closed-days.ts");
const { closedDayError } = await import("../src/lib/closed-days-server.ts");
const { businessDay } = await import("../src/lib/ops/time.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

console.log(`Machine zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
check("Closed weekdays are Sunday only", JSON.stringify(CLOSED_WEEKDAYS) === "[0]");
check("The note says Sundays", CLOSED_DAYS_NOTE === "We're closed Sundays.");

// Dates on the Central calendar.
const dates = [
  ["2026-10-03", false, "Saturday"],
  ["2026-10-04", true, "Sunday"],
  ["2026-10-05", false, "Monday"],
  ["2026-11-01", true, "Sunday DST ends (CDT to CST)"],
  ["2026-12-27", true, "Sunday in CST"],
  ["2027-03-14", true, "Sunday DST starts (CST to CDT)"],
  ["2027-03-13", false, "Saturday before DST starts"],
  ["2026-02-31", false, "not a real date"],
  ["Sunday", false, "not a date at all"],
];
for (const [d, want, label] of dates) check(`isClosedDate ${d} ${label}`, isClosedDate(d) === want);

const next = [
  ["2026-10-03", "2026-10-03"],
  ["2026-10-04", "2026-10-05"],
  ["2026-11-01", "2026-11-02"],
  ["2027-01-03", "2027-01-04"],
  ["2026-12-31", "2026-12-31"],
];
for (const [d, want] of next) check(`nextOpenDate ${d} is ${want}`, nextOpenDate(d) === want, nextOpenDate(d));

// A booking's date and start time, as the public actions see them. By
// business day: 1 a.m. Sunday is Saturday night (open), 1 a.m. Monday is
// Sunday night (closed).
const slots = [
  ["2026-10-03", "23:30", false, "Saturday 11:30 PM"],
  ["2026-10-04", "00:30", false, "Sunday 12:30 AM is still Saturday night"],
  ["2026-10-04", "03:59", false, "Sunday 3:59 AM is still Saturday night"],
  ["2026-10-04", "04:00", true, "Sunday 4:00 AM"],
  ["2026-10-04", "19:00", true, "Sunday 7:00 PM"],
  ["2026-10-05", "01:00", true, "Monday 1:00 AM is still Sunday"],
  ["2026-10-05", "04:00", false, "Monday 4:00 AM"],
  ["2026-10-05", "18:00", false, "Monday 6:00 PM"],
  ["2026-11-01", "01:30", false, "DST-end Sunday 1:30 AM (Saturday night)"],
  ["2026-11-01", "18:00", true, "DST-end Sunday 6:00 PM"],
  ["2026-11-02", "03:30", true, "Monday 3:30 AM after DST ends (Sunday)"],
  ["2026-11-02", "04:00", false, "Monday 4:00 AM after DST ends"],
  ["2027-03-14", "01:30", false, "DST-start Sunday 1:30 AM (Saturday night)"],
  ["2027-03-14", "02:30", false, "DST-start Sunday 2:30 AM, a skipped hour"],
  ["2027-03-14", "04:00", true, "DST-start Sunday 4:00 AM"],
  ["2027-03-15", "00:15", true, "Monday 12:15 AM after DST starts (Sunday)"],
];
for (const [d, t, want, label] of slots) {
  const err = closedDayError(d, t);
  check(`closedDayError ${d} ${t} ${label}: ${want ? "refused" : "allowed"}`, want ? err === "We're closed Sundays. Pick another day." : err === null, err ?? "allowed");
}
check("closedDayError refuses a missing time", closedDayError("2026-10-05", "") === "Pick a date and time.");
check("closedDayError refuses a malformed date", closedDayError("10/05/2026", "18:00") === "Pick a date and time.");
check("closedDayError refuses a crafted time", closedDayError("2026-10-05", "25:00") === "Pick a date and time.");
check("closedDayError takes seconds on the time", closedDayError("2026-10-05", "18:00:00") === null);

// Instants: what day it is right now, for the "starting tomorrow" picker.
// 04:30Z on Oct 4 is already Sunday in UTC but Saturday night in Joplin.
const instants = [
  ["2026-10-04T04:30:00Z", false, "Saturday 11:30 PM CDT (Sunday in UTC)"],
  ["2026-10-04T08:59:00Z", false, "Sunday 3:59 AM CDT"],
  ["2026-10-04T09:00:00Z", true, "Sunday 4:00 AM CDT"],
  ["2026-11-01T07:30:00Z", false, "DST-end Sunday 1:30 AM CST (Saturday night)"],
  ["2026-11-01T11:00:00Z", true, "DST-end Sunday 5:00 AM CST"],
];
for (const [iso, want, label] of instants) {
  const day = businessDay(new Date(iso)).date;
  check(`business day at ${iso} ${label}: ${want ? "closed" : "open"}`, isClosedDate(day) === want, day);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
