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
  date: string; // business date
  scheduled: string | null; // "4:00 PM–10:00 PM"
  clockedIn: string | null;
  clockedOut: string | null; // null while still on
  hours: number | null;
  lateMinutes: number | null; // only when 5+ minutes after the scheduled start
  earlyMinutes: number | null; // left 5+ minutes before the scheduled end
  missed: boolean; // scheduled, over, and never clocked in
}

export interface TimesheetPerson {
  employeeId: string;
  name: string;
  shifts: TimesheetShift[];
  hours: number;
  scheduledHours: number;
  lateCount: number;
  missedCount: number;
  overtime: boolean; // over 40 hours in the week (Monday 4 AM to Monday 4 AM)
}

const MATCH_WINDOW_MS = 4 * 3_600_000; // a clock-in within 4 hours of a scheduled start counts as that shift
const GRACE_MIN = 5;

export async function getTimesheet(weekStart: string): Promise<TimesheetPerson[]> {
  const supabase = createAdminClient();
  const from = businessDayWindow(weekStart).start;
  const to = businessDayWindow(shiftDate(weekStart, 7)).start;
  const [n, { data: clocked }, schedule] = await Promise.all([
    names(),
    supabase.from("shifts").select("employee_id, started_at, ended_at").gte("started_at", from).lt("started_at", to).order("started_at"),
    getSchedule(weekStart),
  ]);
  const now = Date.now();
  const people = new Map<string, TimesheetPerson>();
  const person = (id: string) => {
    let p = people.get(id);
    if (!p) {
      p = { employeeId: id, name: n.get(id) ?? "Someone", shifts: [], hours: 0, scheduledHours: 0, lateCount: 0, missedCount: 0, overtime: false };
      people.set(id, p);
    }
    return p;
  };

  const used = new Set<string>();
  for (const c of clocked ?? []) {
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
    p.shifts.push({
      date: businessDay(new Date(c.started_at)).date,
      scheduled: sched ? `${clock(sched.startsAt)}–${clock(sched.endsAt)}` : null,
      clockedIn: c.started_at,
      clockedOut: c.ended_at,
      hours,
      lateMinutes: late !== null && late >= GRACE_MIN ? late : null,
      earlyMinutes: early !== null && early >= GRACE_MIN ? early : null,
      missed: false,
    });
    if (hours) p.hours += hours;
    if (late !== null && late >= GRACE_MIN) p.lateCount++;
  }

  for (const s of schedule) {
    const p = person(s.employeeId);
    p.scheduledHours += (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3_600_000;
    if (used.has(s.id)) continue;
    const over = new Date(s.endsAt).getTime() < now;
    p.shifts.push({ date: businessDay(new Date(s.startsAt)).date, scheduled: `${clock(s.startsAt)}–${clock(s.endsAt)}`, clockedIn: null, clockedOut: null, hours: null, lateMinutes: null, earlyMinutes: null, missed: over });
    if (over) p.missedCount++;
  }

  for (const p of people.values()) p.overtime = p.hours > 40;
  for (const p of people.values()) p.shifts.sort((a, b) => (a.date + (a.clockedIn ?? "")).localeCompare(b.date + (b.clockedIn ?? "")));
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}
