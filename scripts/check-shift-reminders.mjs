// Checks the register's reminder rules (src/lib/ops/reminders.ts) against
// hand-picked moments: before a screening, daily times (including after
// midnight), the schedule running low, dismissals and turned-off reminders.
// No database; nothing is saved.
//
// Usage: node scripts/check-shift-reminders.mjs   (Node 23.6+ runs the .ts directly;
// its "module type" warning is harmless)
import { evaluateReminders } from "../src/lib/ops/reminders.ts";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const NOW = Date.parse("2026-09-26T00:25:00Z"); // 7:25 PM Central, a Friday
const base = {
  reminders: [],
  screenings: [],
  lastScheduledAt: null,
  nowMs: NOW,
  nowMinutes: 19 * 60 + 25,
  today: { date: "2026-09-25", dow: 5 },
  dismissed: new Set(),
  names: new Map([["bryce", "Bryce"]]),
  clock: () => "7:30 PM",
  shortDay: () => "Wed, Sep 30",
};
const r = (o) => ({ id: "r1", kind: "before_screening", message: "Check the movie", minutes: 5, time_of_day: null, days: null, assignee_id: null, active: true, ...o });
const at = (min) => new Date(NOW + min * 60_000).toISOString();
const screening = (id, min) => ({ id, startsAt: at(min), title: "Labyrinth", room: "Theater" });

// before_screening
let out = evaluateReminders({ ...base, reminders: [r({ assignee_id: "bryce" })], screenings: [screening("s4", 4)] });
check("5 min lead: a movie 4 min out is due, for Bryce", out.length === 1 && out[0].assigneeName === "Bryce" && out[0].detail.includes("starts in 4 min") && !out[0].urgent, out[0]?.detail);
out = evaluateReminders({ ...base, reminders: [r()], screenings: [screening("s6", 6)] });
check("5 min lead: a movie 6 min out isn't due yet", out.length === 0);
out = evaluateReminders({ ...base, reminders: [r()], screenings: [screening("s2", 2)] });
check("2 min out is marked urgent", out.length === 1 && out[0].urgent);
out = evaluateReminders({ ...base, reminders: [r()], screenings: [screening("sm5", -5)] });
check("still showing 5 min after it started", out.length === 1 && out[0].detail.includes("started 5 min ago"));
out = evaluateReminders({ ...base, reminders: [r()], screenings: [screening("sm11", -11)] });
check("gone 11 min after it started", out.length === 0);
out = evaluateReminders({ ...base, reminders: [r()], screenings: [screening("s4", 4)], dismissed: new Set(["r1:s4"]) });
check("Done hides it for that screening", out.length === 0);
out = evaluateReminders({ ...base, reminders: [r()], screenings: [screening("a", 3), screening("b", 4)] });
check("two screenings at once give two reminders", out.length === 2);
out = evaluateReminders({ ...base, reminders: [r({ active: false })], screenings: [screening("s4", 4)] });
check("a turned-off reminder never shows", out.length === 0);

// daily
const daily = (o) => r({ kind: "daily", message: "Thaw tomorrow's dough", minutes: null, time_of_day: "15:00:00", ...o });
out = evaluateReminders({ ...base, reminders: [daily()], nowMinutes: 14 * 60 + 59 });
check("daily 3 PM: not due at 2:59", out.length === 0);
out = evaluateReminders({ ...base, reminders: [daily()], nowMinutes: 15 * 60 });
check("daily 3 PM: due at 3:00", out.length === 1 && out[0].occurrence === "2026-09-25");
out = evaluateReminders({ ...base, reminders: [daily({ days: [1, 3] })], nowMinutes: 16 * 60 });
check("Mon/Wed only: not due on a Friday", out.length === 0);
out = evaluateReminders({ ...base, reminders: [daily({ time_of_day: "23:00:00" })], nowMinutes: 30 });
check("11 PM reminder still due at 12:30 AM (business day runs to 4 AM)", out.length === 1);

// schedule_low
const low = (o) => r({ kind: "schedule_low", message: "Update the schedule", minutes: 7, ...o });
out = evaluateReminders({ ...base, reminders: [low()], lastScheduledAt: at(6 * 1440) });
check("schedule ends in 6 days: remind", out.length === 1 && out[0].detail.includes("only scheduled through"), out[0]?.detail);
out = evaluateReminders({ ...base, reminders: [low()], lastScheduledAt: at(8 * 1440) });
check("schedule ends in 8 days: quiet", out.length === 0);
out = evaluateReminders({ ...base, reminders: [low()], lastScheduledAt: null });
check("nothing scheduled at all: remind", out.length === 1 && out[0].detail.includes("Nothing is scheduled"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll reminder checks passed.");
process.exit(failures ? 1 : 0);
