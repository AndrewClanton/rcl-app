// Hours and clock-out fixes against the live database, through the real
// code, with throwaway rows that are always deleted at the end: two staff
// members switched off (active = false) and their shifts, dated January 2020
// so no real week, timesheet or pay period ever includes them. Real shifts
// are never touched.
//
//  - A forgotten clock-out: flagged, 0 hours, the suggested clock-out (end
//    of the business day, then when the bar closed that night), listed with
//    the other forgotten ones, and the register's "My hours" for it.
//  - Every refusal: bad ids, no reason, bad or impossible times, clock-out
//    before clock-in, over 24 hours, in the future, on top of another shift,
//    leaving a forgotten or finished shift open, nothing changed.
//  - Set the clock-out, then edit the clock-in: both logged with the times
//    before and after, the shift marked edited, an untouched time keeping
//    its seconds, the hours right on the timesheet.
//  - Pay periods, hour formatting, and that the daily email's shift lookup
//    (shifts → employees) still works with the new columns.
//
// Usage: node scripts/check-shift-edits-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;

const migrated = (await q("select count(*)::int as n from information_schema.columns where table_name = 'shifts' and column_name in ('edited_by', 'edited_at', 'edit_note')"))[0].n === 3;
if (!migrated) {
  console.log("The shift_edits migration (20260930041500) isn't applied yet. Apply it first.");
  await c.end();
  process.exit(1);
}

const TAG = "Shift-edit check (delete me)";
const [e1] = await q("insert into employees (name, pin_hash, role, active) values ($1, 'x', 'cashier', false) returning id, name", [TAG]);
const [e2] = await q("insert into employees (name, pin_hash, role, active) values ($1, 'x', 'cashier', false) returning id, name", [`${TAG} 2`]);

// The actions check the manager's session; here it's the throwaway person, without signing in.
const session = JSON.stringify({ employeeId: e1.id, name: e1.name, role: "manager", email: "check@invalid" });
const stubs = {
  "server-only": "",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "@/lib/auth": `const s = ${session};
    export async function assertStaff() { return s; }
    export async function getStaffSession() { return s; }
    export async function assertManager() { return s; }
    export function hasManagerAccess() { return true; }
    export function hasAdminAccess() { return true; }`,
};
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
      const stubs = ${JSON.stringify(stubs)};
      const srcRoot = ${JSON.stringify(srcRoot)};
      export async function resolve(s, ctx, next) {
        if (Object.hasOwn(stubs, s)) return { url: "data:text/javascript," + encodeURIComponent(stubs[s]), shortCircuit: true };
        if (s.startsWith("@/")) s = srcRoot + s.slice(2);
        const local = s.startsWith("./") || s.startsWith("../") || s.startsWith("file:");
        if (local && !/[.](ts|tsx|js|mjs|cjs|json)$/.test(s)) {
          try {
            return await next(s + ".ts", ctx);
          } catch {}
        }
        return next(s, ctx);
      }`),
);

const team = await import("../src/lib/data/team.ts");
const actions = await import("../src/app/admin/team/actions.ts");
const hoursActions = await import("../src/app/pos/hours-actions.ts");
const { formatHours, centralLocal } = await import("../src/lib/hours.ts");
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");

const WEEK = "2020-01-06"; // a Monday
const ms = (iso) => new Date(iso).getTime();
const shiftRow = async (id) => (await q("select started_at, ended_at, edited_by, edited_at, edit_note from shifts where id = $1", [id]))[0];
const edits = async (id) => q("select * from shift_edits where shift_id = $1 order by edited_at", [id]);
const mine = async (week = WEEK) => (await team.getTimesheet(week, e1.id))[0];

try {
  // B: Wed Jan 8, 10:00:37 AM to 4:00 PM Central (seconds on purpose).
  const [b] = await q("insert into shifts (employee_id, started_at, ended_at) values ($1, '2020-01-08T16:00:37.123Z', '2020-01-08T22:00:00Z') returning id", [e1.id]);
  // A: Tue Jan 7, 4:00 PM Central, never clocked out.
  const [a] = await q("insert into shifts (employee_id, started_at) values ($1, '2020-01-07T22:00:00Z') returning id", [e1.id]);

  // ---------- the forgotten one ----------
  let p = await mine();
  let sa = p?.shifts.find((s) => s.shiftId === a.id);
  check("forgotten: flagged, 0 hours, not running", !!sa && sa.forgotten && sa.hours === null && sa.runningHours === null && p.forgottenCount === 1);
  check("forgotten: suggested clock-out is the end of the business day (4 AM)", sa?.suggestedFrom === "day_end" && ms(sa.suggestedOut) === ms("2020-01-08T10:00:00Z"), sa?.suggestedOut);
  check("forgotten: the week's hours are only the finished shift", Math.abs(p.hours - (ms("2020-01-08T22:00:00Z") - ms("2020-01-08T16:00:37.123Z")) / 3_600_000) < 1e-9, String(p.hours));

  // Someone else closed for the night at 11:30 PM: that becomes the suggestion.
  await q("insert into shifts (employee_id, started_at, ended_at, closed_for_night) values ($1, '2020-01-07T23:00:00Z', '2020-01-08T05:30:00Z', true)", [e2.id]);
  sa = (await mine()).shifts.find((s) => s.shiftId === a.id);
  check("forgotten: suggested clock-out is when the bar closed", sa?.suggestedFrom === "close" && ms(sa.suggestedOut) === ms("2020-01-08T05:30:00Z"), sa?.suggestedOut);
  const everyone = await team.getTimesheet(WEEK);
  check("timesheet for everyone has both throwaway people", everyone.some((x) => x.employeeId === e1.id) && everyone.some((x) => x.employeeId === e2.id));

  const forgottenMine = await team.getForgottenClockOuts(e1.id);
  check("forgotten list (one person)", forgottenMine.length === 1 && forgottenMine[0].shiftId === a.id && forgottenMine[0].name === TAG);
  const forgottenAll = await team.getForgottenClockOuts();
  check("forgotten list (everyone) includes it, oldest first", forgottenAll[0]?.shiftId === a.id, `${forgottenAll.length} in all`);

  const owner = await team.openShiftOwner(a.id);
  check("open shift owner", owner?.employeeId === e1.id && owner?.name === TAG);
  const wk = await hoursActions.getShiftWeekHours(a.id);
  check("register My hours: this week's total for that person", wk.ok === true && wk.hours === 0, JSON.stringify(wk));
  check("register My hours: refuses a finished shift", (await hoursActions.getShiftWeekHours(b.id)).ok === false);
  check("register My hours: refuses a bad id", (await hoursActions.getShiftWeekHours("x")).ok === false && (await hoursActions.getShiftWeekHours("00000000-0000-4000-8000-000000000000")).ok === false);

  // ---------- refusals ----------
  const edit = (shiftId, clockIn, clockOut, note = "Forgot to End shift") => actions.editShiftTimes({ shiftId, clockIn, clockOut, note });
  const refused = async (label, r) => check(`refused: ${label}`, r.ok === false, r.ok ? "saved!" : r.error);
  await refused("a shift id that isn't one", await edit("x", "2020-01-07T16:00", "2020-01-07T23:00"));
  await refused("a shift that doesn't exist", await edit("00000000-0000-4000-8000-000000000000", "2020-01-07T16:00", "2020-01-07T23:00"));
  await refused("no reason", await edit(a.id, "2020-01-07T16:00", "2020-01-07T23:00", "  "));
  await refused("a reason over 200 characters", await edit(a.id, "2020-01-07T16:00", "2020-01-07T23:00", "x".repeat(201)));
  await refused("a time in the wrong shape", await edit(a.id, "2020-01-07T16:00", "2020-01-07 23:00"));
  await refused("a day that doesn't exist", await edit(a.id, "2020-01-07T16:00", "2020-02-31T10:00"));
  await refused("an hour that doesn't exist", await edit(a.id, "2020-01-07T16:00", "2020-01-07T25:00"));
  await refused("clock-out before clock-in", await edit(a.id, "2020-01-07T16:00", "2020-01-07T15:00"));
  await refused("more than 24 hours", await edit(a.id, "2020-01-07T16:00", "2020-01-08T16:01"));
  await refused("a clock-out in the future", await edit(b.id, "2020-01-08T10:00", "2099-01-01T10:00"));
  await refused("a clock-in in the future", await edit(b.id, "2099-01-01T10:00", "2099-01-01T11:00"));
  await refused("on top of another of their shifts", await edit(a.id, "2020-01-07T16:00", "2020-01-08T11:00"));
  await refused("leaving a forgotten one open", await edit(a.id, "2020-01-07T16:00", ""));
  await refused("leaving a finished one open", await edit(b.id, "2020-01-08T10:00", ""));
  await refused("nothing changed", await edit(b.id, centralLocal("2020-01-08T16:00:37.123Z"), "2020-01-08T16:00"));
  const untouched = await shiftRow(a.id);
  check("refusals changed nothing", untouched.ended_at === null && untouched.edited_at === null && (await edits(a.id)).length === 0 && (await edits(b.id)).length === 0);

  // ---------- set the clock-out ----------
  const r1 = await edit(a.id, "2020-01-07T16:00", "2020-01-07T23:00");
  check("set clock-out: saved", r1.ok === true, r1.ok ? "" : r1.error);
  let row = await shiftRow(a.id);
  check("set clock-out: 11:00 PM Central", ms(row.ended_at) === ms("2020-01-08T05:00:00Z"), String(row.ended_at));
  check("set clock-out: clock-in untouched", ms(row.started_at) === ms("2020-01-07T22:00:00Z"));
  check("set clock-out: marked edited, by whom, why", row.edited_by === e1.id && !!row.edited_at && row.edit_note === "Forgot to End shift");
  let log = await edits(a.id);
  check("set clock-out: logged before and after", log.length === 1 && log[0].old_ended_at === null && ms(log[0].new_ended_at) === ms("2020-01-08T05:00:00Z") && ms(log[0].old_started_at) === ms(log[0].new_started_at) && log[0].edited_by === e1.id);
  p = await mine();
  sa = p.shifts.find((s) => s.shiftId === a.id);
  check("timesheet: 7 hours, no longer forgotten, marked edited", sa.hours === 7 && !sa.forgotten && sa.edited?.byName === TAG && sa.edited?.note === "Forgot to End shift" && p.forgottenCount === 0);
  check("forgotten list: gone", (await team.getForgottenClockOuts(e1.id)).length === 0);
  check("register My hours: a closed shift gets nothing now", (await hoursActions.getShiftWeekHours(a.id)).ok === false);
  await refused("the same times again", await edit(a.id, "2020-01-07T16:00", "2020-01-07T23:00"));

  // ---------- edit the clock-in ----------
  const r2 = await edit(a.id, "2020-01-07T16:30", "2020-01-07T23:00", "Clocked in late on the iPad");
  check("edit clock-in: saved", r2.ok === true, r2.ok ? "" : r2.error);
  row = await shiftRow(a.id);
  check("edit clock-in: moved, clock-out kept exactly", ms(row.started_at) === ms("2020-01-07T22:30:00Z") && ms(row.ended_at) === ms("2020-01-08T05:00:00Z") && row.edit_note === "Clocked in late on the iPad");
  log = await edits(a.id);
  check("edit clock-in: second log line", log.length === 2 && ms(log[1].old_started_at) === ms("2020-01-07T22:00:00Z") && ms(log[1].new_started_at) === ms("2020-01-07T22:30:00Z"));

  // An untouched clock-in keeps its seconds.
  const r3 = await edit(b.id, centralLocal("2020-01-08T16:00:37.123Z"), "2020-01-08T15:00", "Left at 3");
  row = await shiftRow(b.id);
  check("untouched clock-in keeps its seconds", r3.ok === true && ms(row.started_at) === ms("2020-01-08T16:00:37.123Z") && ms(row.ended_at) === ms("2020-01-08T21:00:00Z"), r3.ok ? String(row.started_at) : r3.error);

  p = await mine();
  const expect = 6.5 + (ms("2020-01-08T21:00:00Z") - ms("2020-01-08T16:00:37.123Z")) / 3_600_000;
  check("timesheet: the week's total", Math.abs(p.hours - expect) < 1e-9 && p.shifts.every((s) => s.edited), `${p.hours.toFixed(4)} h`);

  // ---------- pay periods, formatting ----------
  const pp = [
    ["2026-09-28", "2026-09-28"],
    ["2026-10-01", "2026-09-28"],
    ["2026-10-05", "2026-09-28"],
    ["2026-10-11", "2026-09-28"],
    ["2026-10-12", "2026-10-12"],
    ["2026-09-21", "2026-09-14"],
    ["2020-01-08", team.payPeriodStart("2020-01-08")],
  ];
  check("pay period starts", pp.every(([d, want]) => team.payPeriodStart(d) === want), pp.map(([d]) => `${d}→${team.payPeriodStart(d)}`).join(" "));
  const fh = [
    [0, "0 m"],
    [0.75, "45 m"],
    [8, "8 h"],
    [12.5, "12 h 30 m"],
    [7.999, "8 h"],
  ];
  check("hours formatting", fh.every(([h, want]) => formatHours(h) === want), fh.map(([h]) => formatHours(h)).join(", "));
  check("Central wall-clock times, both sides of daylight saving", centralLocal("2020-01-08T05:00:00Z") === "2020-01-07T23:00" && centralLocal("2026-07-01T05:00:00Z") === "2026-07-01T00:00");

  // The daily email looks up shifts → employees; the new columns mustn't make that ambiguous.
  const { error } = await createAdminClient().from("shifts").select("started_at, ended_at, employee:employees(name)").limit(1);
  check("daily email's shift lookup still works", !error, error?.message);
} finally {
  await q("delete from shifts where employee_id = any($1)", [[e1.id, e2.id]]);
  await q("delete from employees where id = any($1)", [[e1.id, e2.id]]);
  const left = (await q(
    `select (select count(*) from employees where name like 'Shift-edit check%')::int as e,
            (select count(*) from shifts where employee_id = any($1))::int as s,
            (select count(*) from shift_edits where edited_by = any($1))::int as l`,
    [[e1.id, e2.id]],
  ))[0];
  console.log(`\nCleaned up the throwaway people, their shifts and fix log. Left behind: ${left.e + left.s + left.l}.`);
  await c.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
