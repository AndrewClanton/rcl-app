import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { shiftDate } from "@/lib/ops/time";
import { getForgottenClockOuts, getSchedule, getTeam, getTimesheet, getTodos, payPeriodStart, thisWeek, weekStartOf } from "@/lib/data/team";
import ScheduleWeek from "./ScheduleWeek";
import TodoManager from "./TodoManager";
import { ForgottenList, Totals, WeekTimesheet } from "./Timesheets";

export const dynamic = "force-dynamic";

// Back office → Team, for managers and up: who's scheduled when, one-off
// to-dos for a person (they show on the register for them), and timesheets
// from actual clock-ins (by the week or the two-week pay period), where a
// forgotten clock-out or a wrong time gets fixed.

const TZ = "America/Chicago";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Params = { view?: string; week?: string; period?: string };

export default async function TeamPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireManager();
  const p = await searchParams;
  const view = p.view === "todos" || p.view === "timesheets" ? p.view : "schedule";
  // Timesheets by the week, or by the two-week pay period.
  const pay = view === "timesheets" && p.period === "pay";
  const picked = p.week && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? weekStartOf(p.week) : thisWeek();
  const week = pay ? payPeriodStart(picked) : picked;
  const current = pay ? payPeriodStart(thisWeek()) : thisWeek();
  const step = pay ? 14 : 7;
  const period = pay ? "pay" : undefined;
  const link = (q: Params) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return `/admin/team${s ? `?${s}` : ""}`;
  };
  const weekLabel = `${pay ? "Pay period " : ""}${dayLabel(week)} – ${dayLabel(shiftDate(week, step - 1))}`;

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
          <Link href={link({ view: view === "schedule" ? undefined : view, week: shiftDate(week, -step), period })} className="chip !px-2.5 !py-1 !text-sm" aria-label={pay ? "Previous pay period" : "Previous week"}>
            ◀
          </Link>
          <span className="min-w-[13rem] text-center text-sm font-semibold">{weekLabel}</span>
          <Link href={link({ view: view === "schedule" ? undefined : view, week: shiftDate(week, step), period })} className="chip !px-2.5 !py-1 !text-sm" aria-label={pay ? "Next pay period" : "Next week"}>
            ▶
          </Link>
          {week !== current && (
            <Link href={link({ view: view === "schedule" ? undefined : view, period })} className="chip !px-3 !py-1 !text-sm">
              {pay ? "This pay period" : "This week"}
            </Link>
          )}
          {view === "timesheets" && (
            <span className="ml-auto flex gap-2">
              <Link href={link({ view, week: week === thisWeek() ? undefined : week })} className={`chip !px-3 !py-1 !text-sm ${pay ? "" : "chip-selected font-bold"}`}>
                Week
              </Link>
              <Link href={link({ view, week: week === thisWeek() ? undefined : week, period: "pay" })} className={`chip !px-3 !py-1 !text-sm ${pay ? "chip-selected font-bold" : ""}`}>
                Pay period
              </Link>
            </span>
          )}
        </div>
      )}

      {view === "schedule" && <ScheduleView week={week} />}
      {view === "todos" && <TodosView />}
      {view === "timesheets" && <ForgottenClockOuts />}
      {view === "timesheets" && (pay ? <PayPeriodView start={week} link={(w) => link({ view, week: w })} /> : <TimesheetView week={week} />)}
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

// Everyone who clocked in on an earlier day and never clocked out, from any week.
async function ForgottenClockOuts() {
  return <ForgottenList forgotten={await getForgottenClockOuts()} />;
}

async function PayPeriodView({ start, link }: { start: string; link: (week: string) => string }) {
  const second = shiftDate(start, 7);
  const [a, b] = await Promise.all([getTimesheet(start), getTimesheet(second)]);
  if (!a.length && !b.length) return <p className="text-sm text-[var(--muted)]">Nobody clocked in or was scheduled this pay period.</p>;
  return (
    <div className="space-y-4">
      <Totals
        people={[a, b]}
        weeks={[
          { label: `Week of ${dayLabel(start)}`, href: link(start) },
          { label: `Week of ${dayLabel(second)}`, href: link(second) },
        ]}
      />
      <p className="text-xs text-[var(--muted)]">Tap a week for its shifts, and to fix a clock-in or clock-out.</p>
    </div>
  );
}

async function TimesheetView({ week }: { week: string }) {
  return <WeekTimesheet people={await getTimesheet(week)} />;
}
