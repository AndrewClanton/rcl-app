import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow, shiftDate } from "@/lib/ops/time";
import { getPartialRefunds } from "@/lib/data/reports";
import { getForgottenClockOuts, getTimesheet, payPeriodStart, thisWeek, type TimesheetPerson, type TimesheetShift } from "@/lib/data/team";
import { getTrainingFor, type TrainingState } from "@/lib/training/data";

// Back office → My account: one person's own record. Their shifts and
// hours this pay period, what's on their calendar (scheduled shifts,
// to-dos, trainings due), what they've done lately (checklist tasks,
// to-dos, par counts, Ran out reports), and what they rang up on the
// register, with the tips paid out to them. Read only; everything comes
// from tables the register and Team already write. Each part is read on
// its own, and a failed read is null so the page leaves that part out.

const TZ = "America/Chicago";
const DONE_DAYS = 30; // "done lately" looks back this far
const AHEAD_DAYS = 14; // the calendar looks this far ahead

export interface AccountPerson {
  id: string;
  name: string;
  role: string;
  active: boolean;
  since: string | null; // when their login was made
}

export interface CalendarItem {
  kind: "shift" | "todo" | "training";
  id: string;
  date: string | null; // business date; null for a to-do with no due date
  at: string | null; // a shift's start (ISO)
  until: string | null; // a shift's end (ISO)
  title: string;
  detail: string | null;
  overdue: boolean;
  href: string | null;
}

export interface DoneItem {
  kind: "task" | "todo" | "par" | "ranout";
  id: string;
  at: string; // ISO
  title: string;
  detail: string | null;
}

export interface SalesTotals {
  orders: number;
  taken: number; // what customers paid on them, with tax and tips, less partial refunds
  tips: number; // tips added on those orders
}

export interface AccountData {
  person: AccountPerson;
  // The two weeks of the pay period we're in, and each week's timesheet.
  period: { start: string; end: string; weeks: { start: string; sheet: TimesheetPerson | null }[] } | null;
  forgotten: TimesheetShift[];
  calendar: CalendarItem[] | null;
  done: DoneItem[] | null;
  sales: { week: SalesTotals; period: SalesTotals; days: { date: string; orders: number; taken: number; tips: number }[] } | null;
  tipsPaid: { period: number; days: { date: string; amount: number }[] } | null;
  trainings: { open: number; overdue: number; done: number } | null;
}

async function quietly<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

const dayOf = (iso: string) => businessDay(new Date(iso)).date;

// Null only when there's no such person; a database error is thrown, so it
// shows as an error rather than as "not found".
export async function getAccount(employeeId: string): Promise<AccountData | null> {
  const db = createAdminClient();
  const { data: emp, error: empError } = await db.from("employees").select("id, name, role, active, created_at").eq("id", employeeId).maybeSingle();
  if (empError) throw empError;
  if (!emp) return null;
  const person: AccountPerson = { id: emp.id, name: emp.name, role: emp.role, active: emp.active !== false, since: (emp.created_at as string | null) ?? null };

  const today = businessDay().date;
  const week = thisWeek();
  const start = payPeriodStart(week);
  const second = shiftDate(start, 7);
  const periodEnd = shiftDate(start, 13);
  const periodFrom = businessDayWindow(start).start;
  const periodTo = businessDayWindow(periodEnd).end;
  const doneSince = new Date(Date.now() - DONE_DAYS * 86_400_000).toISOString();
  // Read once: the calendar lists the ones due, the summary counts them all.
  const trainingRead = quietly(() => getTrainingFor(employeeId));

  const [sheets, forgotten, calendar, done, sales, tipsPaid, trainingList] = await Promise.all([
    quietly(() => Promise.all([getTimesheet(start, employeeId), getTimesheet(second, employeeId)]).then(([a, b]) => [a[0] ?? null, b[0] ?? null])),
    quietly(() => getForgottenClockOuts(employeeId)),

    // On their calendar: scheduled shifts for two weeks, their open to-dos,
    // and trainings assigned to them that aren't signed off.
    quietly(async () => {
      const now = new Date().toISOString();
      const until = businessDayWindow(shiftDate(today, AHEAD_DAYS)).end;
      const [shifts, todos, trainingsOrNull] = await Promise.all([
        db.from("staff_schedule").select("id, starts_at, ends_at, note").eq("employee_id", employeeId).is("deleted_at", null).gte("ends_at", now).lt("starts_at", until).order("starts_at"),
        db.from("staff_todos").select("id, title, details, due_date").eq("assignee_id", employeeId).is("done_at", null).order("due_date", { ascending: true, nullsFirst: false }),
        trainingRead,
      ]);
      if (shifts.error) throw shifts.error;
      if (todos.error) throw todos.error;
      // Trainings that couldn't be read are left off; the shifts and to-dos still show.
      const trainings = trainingsOrNull ?? [];
      const items: CalendarItem[] = [
        ...shifts.data.map((s) => ({
          kind: "shift" as const,
          id: s.id as string,
          date: dayOf(s.starts_at as string),
          at: s.starts_at as string,
          until: s.ends_at as string,
          title: "Scheduled shift",
          detail: (s.note as string | null) ?? null,
          overdue: false,
          href: null,
        })),
        ...todos.data.map((t) => ({
          kind: "todo" as const,
          id: t.id as string,
          date: (t.due_date as string | null) ?? null,
          at: null,
          until: null,
          title: t.title as string,
          detail: (t.details as string | null) ?? null,
          overdue: !!t.due_date && (t.due_date as string) < today,
          href: null,
        })),
        ...trainings
          .filter((t) => t.assigned && t.state !== "done")
          .map((t) => ({
            kind: "training" as const,
            id: t.slug,
            date: t.dueDate,
            at: null,
            until: null,
            title: `Training: ${t.title}`,
            detail: stateText(t.state),
            overdue: t.overdue,
            href: `/training/${t.slug}`,
          })),
      ];
      // Dated things in order (overdue first, as they're earliest), then undated.
      return items.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") || (a.at ?? "").localeCompare(b.at ?? ""));
    }),

    // Done lately: checklist tasks ticked, to-dos finished, par counts, Ran out reports.
    quietly(async () => {
      const [tasks, todos, pars, outs] = await Promise.all([
        db.from("task_completions").select("id, completed_at, work_date, task:shift_tasks(title, timing)").eq("completed_by", employeeId).gte("completed_at", doneSince).order("completed_at", { ascending: false }).limit(200),
        db.from("staff_todos").select("id, title, done_at, outage_id").eq("done_by", employeeId).gte("done_at", doneSince).order("done_at", { ascending: false }).limit(100),
        db.from("par_counts").select("id, completed_at, lines:par_count_lines(item_id)").eq("counted_by", employeeId).gte("completed_at", doneSince).order("completed_at", { ascending: false }).limit(60),
        db.from("stock_outages").select("id, label, reported_at, resolution").eq("reported_by", employeeId).gte("reported_at", doneSince).order("reported_at", { ascending: false }).limit(60),
      ]);
      if (tasks.error) throw tasks.error;
      if (todos.error) throw todos.error;
      const items: DoneItem[] = [
        ...(tasks.data as unknown as { id: string; completed_at: string; task: { title: string; timing: string } | null }[]).map((t) => ({
          kind: "task" as const,
          id: t.id,
          at: t.completed_at,
          title: t.task?.title ?? "A checklist task",
          detail: t.task?.timing === "opening" ? "Opening checklist" : t.task?.timing === "closing" ? "Closing checklist" : "Checklist",
        })),
        ...todos.data.map((t) => ({ kind: "todo" as const, id: t.id as string, at: t.done_at as string, title: t.title as string, detail: t.outage_id ? "Restock to-do" : "To-do" })),
        // Par counts and Ran out may not be there on an older database; they're just left out.
        ...(pars.error
          ? []
          : (pars.data as unknown as { id: string; completed_at: string; lines: { item_id: string }[] | null }[]).map((p) => ({
              kind: "par" as const,
              id: p.id,
              at: p.completed_at,
              title: "Par count",
              detail: p.lines?.length ? `${p.lines.length} ${p.lines.length === 1 ? "line" : "lines"} counted` : null,
            }))),
        ...(outs.error
          ? []
          : outs.data.map((o) => ({
              kind: "ranout" as const,
              id: o.id as string,
              at: o.reported_at as string,
              title: `Reported ran out: ${o.label as string}`,
              detail: o.resolution === "bought" ? "Bought since" : o.resolution === "found" ? "Some was found" : o.resolution === "mistake" ? "False alarm" : "Still out",
            }))),
      ];
      return items.sort((a, b) => b.at.localeCompare(a.at));
    }),

    // What they rang on the register this pay period: finished orders
    // only (refunded ones don't count), less anything given back in a
    // partial refund, the same as the reports.
    quietly(async () => {
      const rows: { id: string; completed_at: string; total: number; tip: number }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("orders")
          .select("id, completed_at, total, tip")
          .eq("employee_id", employeeId)
          .eq("status", "completed")
          .gte("completed_at", periodFrom)
          .lt("completed_at", periodTo)
          .order("completed_at")
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...(data as { id: string; completed_at: string; total: number; tip: number }[]));
        if (!data || data.length < 1000) break;
      }
      const mine = new Set(rows.map((o) => o.id));
      const givenBack = new Map<string, number>();
      for (const p of await getPartialRefunds(periodFrom, periodTo)) {
        if (mine.has(p.order_id)) givenBack.set(p.order_id, (givenBack.get(p.order_id) ?? 0) + Number(p.amount));
      }
      const empty = (): SalesTotals => ({ orders: 0, taken: 0, tips: 0 });
      const weekFrom = businessDayWindow(week).start;
      const byDay = new Map<string, { date: string; orders: number; taken: number; tips: number }>();
      const period = empty();
      const thisWeekTotals = empty();
      for (const o of rows) {
        const add = (t: SalesTotals) => {
          t.orders += 1;
          t.taken += Number(o.total) - (givenBack.get(o.id) ?? 0);
          t.tips += Number(o.tip);
        };
        add(period);
        if (o.completed_at >= weekFrom) add(thisWeekTotals);
        const date = dayOf(o.completed_at);
        const d = byDay.get(date) ?? { date, orders: 0, taken: 0, tips: 0 };
        add(d);
        byDay.set(date, d);
      }
      return { week: thisWeekTotals, period, days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    }),

    // Tip payouts recorded for them this pay period (Reports → Day → Tips).
    quietly(async () => {
      const { data, error } = await db.from("tip_payouts").select("business_date, amount").eq("employee_id", employeeId).gte("business_date", start).lte("business_date", periodEnd).order("business_date");
      if (error) throw error;
      const days = data.map((d) => ({ date: d.business_date as string, amount: Number(d.amount) }));
      return { period: days.reduce((s, d) => s + d.amount, 0), days };
    }),

    trainingRead,
  ]);

  const assigned = (trainingList ?? []).filter((t) => t.assigned);
  return {
    person,
    period: sheets
      ? {
          start,
          end: periodEnd,
          weeks: [
            { start, sheet: sheets[0] },
            { start: second, sheet: sheets[1] },
          ],
        }
      : null,
    forgotten: forgotten ?? [],
    calendar,
    done,
    sales,
    tipsPaid,
    trainings: trainingList
      ? {
          open: assigned.filter((t) => t.state !== "done").length,
          overdue: assigned.filter((t) => t.overdue).length,
          done: trainingList.filter((t) => t.state === "done").length,
        }
      : null,
  };
}

function stateText(state: TrainingState | null) {
  if (state === "new") return "Not started";
  if (state === "started") return "Started, not signed off";
  if (state === "update") return "Changed since you signed it: sign again";
  return null;
}

// "Tue, Sep 29" for a business date.
export function accountDay(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export const accountClock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
