import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow, shiftDate } from "@/lib/ops/time";

// The team tools behind Back office → Team: the staff schedule, one-off
// to-dos assigned to a person, and timesheets built from actual clock-ins
// (the register's Start/End shift) compared with the schedule.

const TZ = "America/Chicago";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

export interface TeamMember {
  id: string;
  name: string;
  role: string;
}

export interface Todo {
  id: string;
  title: string;
  details: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdByName: string | null;
  createdAt: string;
  doneAt: string | null;
  doneByName: string | null;
}

export interface ScheduledShift {
  id: string;
  employeeId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
}

export async function getTeam(): Promise<TeamMember[]> {
  const { data } = await createAdminClient().from("employees").select("id, name, role").eq("active", true).neq("role", "display").order("name");
  return (data ?? []).map((e) => ({ id: e.id, name: e.name, role: e.role }));
}

async function names() {
  const { data } = await createAdminClient().from("employees").select("id, name");
  return new Map((data ?? []).map((e) => [e.id as string, e.name as string]));
}

// Open to-dos, plus the ones finished in the last `doneDays` days.
export async function getTodos(doneDays = 14): Promise<Todo[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - doneDays * 86_400_000).toISOString();
  const [n, { data }] = await Promise.all([
    names(),
    supabase.from("staff_todos").select("*").or(`done_at.is.null,done_at.gte."${since}"`).order("done_at", { ascending: false, nullsFirst: true }).order("due_date", { ascending: true, nullsFirst: false }).order("created_at"),
  ]);
  return (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    details: t.details,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_id ? (n.get(t.assignee_id) ?? null) : null,
    dueDate: t.due_date,
    createdByName: t.created_by ? (n.get(t.created_by) ?? null) : null,
    createdAt: t.created_at,
    doneAt: t.done_at,
    doneByName: t.done_by ? (n.get(t.done_by) ?? null) : null,
  }));
}

// Monday of the week a business date falls in.
export function weekStartOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((dow + 6) % 7));
}

export function thisWeek(): string {
  return weekStartOf(businessDay().date);
}

export async function getSchedule(weekStart: string): Promise<ScheduledShift[]> {
  const from = businessDayWindow(weekStart).start;
  const to = businessDayWindow(shiftDate(weekStart, 7)).start;
  const [n, { data }] = await Promise.all([names(), createAdminClient().from("staff_schedule").select("*").is("deleted_at", null).gte("starts_at", from).lt("starts_at", to).order("starts_at")]);
  return (data ?? []).map((s) => ({ id: s.id, employeeId: s.employee_id, name: n.get(s.employee_id) ?? "Someone", startsAt: s.starts_at, endsAt: s.ends_at, note: s.note }));
}

// ---------- timesheets ----------

export interface TimesheetShift {
  shiftId: string | null; // the clock-in; null for a scheduled shift nobody clocked in to
  date: string; // business date
  scheduled: string | null; // "4:00 PM–10:00 PM"
  clockedIn: string | null;
  clockedOut: string | null; // null while still on, or if they never clocked out
  hours: number | null;
  runningHours: number | null; // on the clock right now: time so far (not in `hours`)
  forgotten: boolean; // clocked in on an earlier business day, never clocked out: 0 hours until a manager fixes it
  long: boolean; // over 16 hours: probably a late clock-out
  // For a forgotten one, the clock-out a manager is offered: the scheduled
  // end, else when the bar closed that night, else the business day's end.
  suggestedOut: string | null;
  suggestedFrom: "schedule" | "close" | "day_end" | null;
  edited: { byName: string | null; at: string; note: string | null } | null;
  lateMinutes: number | null; // only when 5+ minutes after the scheduled start
  earlyMinutes: number | null; // left 5+ minutes before the scheduled end
  missed: boolean; // scheduled, over, and never clocked in
}

export interface TimesheetPerson {
  employeeId: string;
  name: string;
  shifts: TimesheetShift[];
  hours: number;
  runningHours: number; // the shift they're on right now, so far
  scheduledHours: number;
  lateCount: number;
  missedCount: number;
  forgottenCount: number;
  overtime: boolean; // over 40 hours in the week (Monday 4 AM to Monday 4 AM)
}

const MATCH_WINDOW_MS = 4 * 3_600_000; // a clock-in within 4 hours of a scheduled start counts as that shift
const GRACE_MIN = 5;
const LONG_SHIFT_HOURS = 16;
const MAX_SHIFT_MS = 24 * 3_600_000;

// One week's timesheet, for everyone or (employeeId) one person.
export async function getTimesheet(weekStart: string, employeeId?: string): Promise<TimesheetPerson[]> {
  const supabase = createAdminClient();
  const from = businessDayWindow(weekStart).start;
  const to = businessDayWindow(shiftDate(weekStart, 7)).start;
  const [n, { data: allClocked }, fullSchedule] = await Promise.all([
    names(),
    // Everyone's, even for one person: the night's close comes from whoever closed.
    supabase.from("shifts").select("id, employee_id, started_at, ended_at, closed_for_night, edited_by, edited_at, edit_note").gte("started_at", from).lt("started_at", to).order("started_at"),
    getSchedule(weekStart),
  ]);
  const now = Date.now();
  const today = businessDay().date;
  // When the bar closed each night: the latest "I'm closing for the night" clock-out.
  const closedAt = new Map<string, string>();
  for (const c of allClocked ?? []) {
    if (!c.closed_for_night || !c.ended_at) continue;
    const d = businessDay(new Date(c.started_at)).date;
    if (!closedAt.has(d) || c.ended_at > closedAt.get(d)!) closedAt.set(d, c.ended_at);
  }
  const clocked = employeeId ? (allClocked ?? []).filter((c) => c.employee_id === employeeId) : (allClocked ?? []);
  const schedule = employeeId ? fullSchedule.filter((s) => s.employeeId === employeeId) : fullSchedule;
  const people = new Map<string, TimesheetPerson>();
  const person = (id: string) => {
    let p = people.get(id);
    if (!p) {
      p = { employeeId: id, name: n.get(id) ?? "Someone", shifts: [], hours: 0, runningHours: 0, scheduledHours: 0, lateCount: 0, missedCount: 0, forgottenCount: 0, overtime: false };
      people.set(id, p);
    }
    return p;
  };

  const used = new Set<string>();
  for (const c of clocked) {
    const inMs = new Date(c.started_at).getTime();
    const sched = schedule
      .filter((s) => s.employeeId === c.employee_id && !used.has(s.id) && Math.abs(new Date(s.startsAt).getTime() - inMs) <= MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(new Date(a.startsAt).getTime() - inMs) - Math.abs(new Date(b.startsAt).getTime() - inMs))[0];
    if (sched) used.add(sched.id);
    const outMs = c.ended_at ? new Date(c.ended_at).getTime() : null;
    const late = sched ? Math.round((inMs - new Date(sched.startsAt).getTime()) / 60_000) : null;
    const early = sched && outMs ? Math.round((new Date(sched.endsAt).getTime() - outMs) / 60_000) : null;
    const p = person(c.employee_id);
    const hours = outMs ? (outMs - inMs) / 3_600_000 : null;
    const date = businessDay(new Date(c.started_at)).date;
    const forgotten = !c.ended_at && date < today;
    const running = !c.ended_at && !forgotten ? Math.max(0, now - inMs) / 3_600_000 : null;
    const suggestion = forgotten ? suggestClockOut(inMs, now, sched?.endsAt ?? null, closedAt.get(date) ?? null, businessDayWindow(date).end) : null;
    p.shifts.push({
      shiftId: c.id,
      date,
      scheduled: sched ? `${clock(sched.startsAt)}–${clock(sched.endsAt)}` : null,
      clockedIn: c.started_at,
      clockedOut: c.ended_at,
      hours,
      runningHours: running,
      forgotten,
      long: hours !== null && hours > LONG_SHIFT_HOURS,
      suggestedOut: suggestion?.at ?? null,
      suggestedFrom: suggestion?.from ?? null,
      edited: c.edited_at ? { byName: c.edited_by ? (n.get(c.edited_by) ?? null) : null, at: c.edited_at, note: c.edit_note } : null,
      lateMinutes: late !== null && late >= GRACE_MIN ? late : null,
      earlyMinutes: early !== null && early >= GRACE_MIN ? early : null,
      missed: false,
    });
    if (hours) p.hours += hours;
    if (running) p.runningHours += running;
    if (forgotten) p.forgottenCount++;
    if (late !== null && late >= GRACE_MIN) p.lateCount++;
  }

  for (const s of schedule) {
    const p = person(s.employeeId);
    p.scheduledHours += (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3_600_000;
    if (used.has(s.id)) continue;
    const over = new Date(s.endsAt).getTime() < now;
    p.shifts.push({
      shiftId: null,
      date: businessDay(new Date(s.startsAt)).date,
      scheduled: `${clock(s.startsAt)}–${clock(s.endsAt)}`,
      clockedIn: null,
      clockedOut: null,
      hours: null,
      runningHours: null,
      forgotten: false,
      long: false,
      suggestedOut: null,
      suggestedFrom: null,
      edited: null,
      lateMinutes: null,
      earlyMinutes: null,
      missed: over,
    });
    if (over) p.missedCount++;
  }

  for (const p of people.values()) p.overtime = p.hours > 40;
  for (const p of people.values()) p.shifts.sort((a, b) => (a.date + (a.clockedIn ?? "")).localeCompare(b.date + (b.clockedIn ?? "")));
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The clock-out to offer for a forgotten one: the scheduled end, else when
// the bar closed that night, else the end of the business day (4 AM). Never
// in the future, never more than 24 hours after the clock-in.
function suggestClockOut(inMs: number, now: number, scheduledEnd: string | null, closed: string | null, dayEnd: string): { at: string; from: "schedule" | "close" | "day_end" } {
  const latest = Math.min(now, inMs + MAX_SHIFT_MS);
  const pick = (iso: string | null) => (iso && new Date(iso).getTime() > inMs && new Date(iso).getTime() <= latest ? iso : null);
  const at = pick(scheduledEnd);
  if (at) return { at, from: "schedule" };
  const close = pick(closed);
  if (close) return { at: close, from: "close" };
  return { at: new Date(Math.max(inMs + 60_000, Math.min(new Date(dayEnd).getTime(), latest))).toISOString(), from: "day_end" };
}

// Everyone's clock-ins from an earlier day that never clocked out (any
// week), oldest first. They count as 0 hours until a manager sets the
// clock-out on Team → Timesheets.
export async function getForgottenClockOuts(employeeId?: string): Promise<(TimesheetShift & { employeeId: string; name: string })[]> {
  let q = createAdminClient().from("shifts").select("started_at").is("ended_at", null).lt("started_at", businessDayWindow(businessDay().date).start);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data } = await q;
  const weeks = [...new Set((data ?? []).map((s) => weekStartOf(businessDay(new Date(s.started_at)).date)))];
  const sheets = await Promise.all(weeks.map((w) => getTimesheet(w, employeeId)));
  return sheets
    .flat()
    .flatMap((p) => p.shifts.filter((s) => s.forgotten).map((s) => ({ ...s, employeeId: p.employeeId, name: p.name })))
    .sort((a, b) => (a.clockedIn ?? "").localeCompare(b.clockedIn ?? ""));
}

// Who's on an open shift (the register's "me"), for My hours from the register.
export async function openShiftOwner(shiftId: string): Promise<{ employeeId: string; name: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shiftId)) return null;
  const { data } = await createAdminClient().from("shifts").select("employee_id").eq("id", shiftId).is("ended_at", null).maybeSingle();
  if (!data) return null;
  return { employeeId: data.employee_id as string, name: (await names()).get(data.employee_id as string) ?? "Someone" };
}

// This week's hours so far for one person, counting the shift they're on now.
export async function weekHoursSoFar(employeeId: string): Promise<number> {
  const [p] = await getTimesheet(thisWeek(), employeeId);
  return p ? p.hours + p.runningHours : 0;
}

// ---------- pay periods ----------

// Two weeks, Monday 4 AM to Monday 4 AM, every other Monday counting from
// this one. PAY_PERIOD_START (any date in a period's first week) overrides it.
const PAY_PERIOD_ANCHOR = "2026-09-28";

export function payPeriodStart(date: string): string {
  const env = process.env.PAY_PERIOD_START;
  const anchor = weekStartOf(env && /^\d{4}-\d{2}-\d{2}$/.test(env) ? env : PAY_PERIOD_ANCHOR);
  const week = weekStartOf(date);
  const days = Math.round((Date.parse(`${week}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / 86_400_000);
  return shiftDate(week, -(((days % 14) + 14) % 14));
}
