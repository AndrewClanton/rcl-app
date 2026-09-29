import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { shiftDate } from "@/lib/ops/time";
import { getSchedule, getTeam, getTimesheet, getTodos, thisWeek, weekStartOf } from "@/lib/data/team";
import ScheduleWeek from "./ScheduleWeek";
import TodoManager from "./TodoManager";

export const dynamic = "force-dynamic";

// Back office → Team, for managers and up: who's scheduled when, one-off
// to-dos for a person (they show on the register for them), and timesheets
// from actual clock-ins.

const TZ = "America/Chicago";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Params = { view?: string; week?: string };

export default async function TeamPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireManager();
  const p = await searchParams;
  const view = p.view === "todos" || p.view === "timesheets" ? p.view : "schedule";
  const week = p.week && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? weekStartOf(p.week) : thisWeek();
  const link = (q: Params) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return `/admin/team${s ? `?${s}` : ""}`;
  };
  const weekLabel = `${dayLabel(week)} – ${dayLabel(shiftDate(week, 6))}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-lg font-semibold">Team</h1>
        {[
          ["schedule", "Schedule"],
          ["todos", "To-dos"],
          ["timesheets", "Timesheets"],
        ].map(([v, label]) => (
          <Link key={v} href={link({ view: v === "schedule" ? undefined : v, week: week === thisWeek() ? undefined : week })} className={`chip !px-3 !py-1 !text-sm ${view === v ? "chip-selected font-bold" : ""}`}>
            {label}
          </Link>
        ))}
      </div>

      {view !== "todos" && (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link({ view: view === "schedule" ? undefined : view, week: shiftDate(week, -7) })} className="chip !px-2.5 !py-1 !text-sm" aria-label="Previous week">
            ◀
          </Link>
          <span className="min-w-[13rem] text-center text-sm font-semibold">{weekLabel}</span>
          <Link href={link({ view: view === "schedule" ? undefined : view, week: shiftDate(week, 7) })} className="chip !px-2.5 !py-1 !text-sm" aria-label="Next week">
            ▶
          </Link>
          {week !== thisWeek() && (
            <Link href={link({ view: view === "schedule" ? undefined : view })} className="chip !px-3 !py-1 !text-sm">
              This week
            </Link>
          )}
        </div>
      )}

      {view === "schedule" && <ScheduleView week={week} />}
      {view === "todos" && <TodosView />}
      {view === "timesheets" && <TimesheetView week={week} />}
    </div>
  );
}

async function ScheduleView({ week }: { week: string }) {
  const [team, shifts] = await Promise.all([getTeam(), getSchedule(week)]);
  return (
    <ScheduleWeek
      week={week}
      days={Array.from({ length: 7 }, (_, i) => ({ date: shiftDate(week, i), label: dayLabel(shiftDate(week, i)) }))}
      team={team}
      shifts={shifts.map((s) => ({ ...s, time: `${clock(s.startsAt)}–${clock(s.endsAt)}`, date: new Date(new Date(s.startsAt).getTime() - 4 * 3_600_000).toLocaleDateString("en-CA", { timeZone: TZ }) }))}
    />
  );
}

async function TodosView() {
  const [team, todos] = await Promise.all([getTeam(), getTodos()]);
  return <TodoManager team={team} todos={todos} />;
}

async function TimesheetView({ week }: { week: string }) {
  const people = await getTimesheet(week);
  if (!people.length) return <p className="text-sm text-[var(--muted)]">Nobody clocked in or was scheduled this week.</p>;
  return (
    <div className="space-y-4">
      {people.map((p) => (
        <section key={p.employeeId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold">{p.name}</h2>
            <span className="text-sm tabular-nums">
              <strong>{p.hours.toFixed(2)} h</strong> worked
              {p.scheduledHours > 0 && <span className="text-[var(--muted)]"> of {p.scheduledHours.toFixed(1)} scheduled</span>}
            </span>
            {p.lateCount > 0 && <span className="text-sm font-medium text-[var(--danger-text)]">{p.lateCount} late</span>}
            {p.missedCount > 0 && <span className="text-sm font-medium text-[var(--danger-text)]">{p.missedCount} missed</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1 font-medium">Day</th>
                  <th className="pb-1 font-medium">Scheduled</th>
                  <th className="pb-1 font-medium">In</th>
                  <th className="pb-1 font-medium">Out</th>
                  <th className="pb-1 text-right font-medium">Hours</th>
                  <th className="pb-1 font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {p.shifts.map((s, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="py-1">{dayLabel(s.date)}</td>
                    <td className="py-1 text-[var(--muted)]">{s.scheduled ?? "—"}</td>
                    <td className="py-1">{s.clockedIn ? clock(s.clockedIn) : "—"}</td>
                    <td className="py-1">{s.clockedOut ? clock(s.clockedOut) : s.clockedIn ? <span className="text-[var(--muted)]">still on</span> : "—"}</td>
                    <td className="py-1 text-right">{s.hours !== null ? s.hours.toFixed(2) : ""}</td>
                    <td className="py-1 pl-3 text-xs">
                      {s.missed && <span className="font-bold text-[var(--danger-text)]">Didn&apos;t clock in</span>}
                      {s.lateMinutes !== null && <span className="font-bold text-[var(--danger-text)]">{s.lateMinutes} min late</span>}
                      {s.earlyMinutes !== null && <span className="ml-2 text-[var(--muted)]">left {s.earlyMinutes} min early</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-xs text-[var(--muted)]">
        Hours come from Start shift and End shift on the register. A clock-in within 4 hours of a scheduled start counts as that shift; 5 or more minutes after the
        start is marked late.
      </p>
    </div>
  );
}
