import { requireStaff } from "@/lib/auth";
import { getPeriodReport } from "@/lib/data/period-report";
import { businessDay } from "@/lib/ops/time";
import { isDate, rangeLabel, shiftPeriod, shortDate, weekOf, type Period } from "@/lib/report-periods";
import DateJump from "../DateJump";
import PeriodView from "../PeriodView";
import { PeriodNav, Pill } from "../ui";

export const dynamic = "force-dynamic";

// Reports -> Week: Monday to Sunday. ?date= is any day in the week
// (/admin/reports/week?date=2026-09-21); no date is this week.
export default async function WeekReportPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: asked } = await searchParams;
  const today = businessDay().date;
  const current = weekOf(today);
  const picked = weekOf(isDate(asked) ? asked : today);
  const period = picked.start > current.start ? current : picked;
  const [, report] = await Promise.all([requireStaff(), getPeriodReport(period)]);

  const link = (p: Period) => (p.start === current.start ? "/admin/reports/week" : `/admin/reports/week?date=${p.start}`);
  const next = shiftPeriod(period, 1);
  const last = shiftPeriod(current, -1);

  return (
    <div className="space-y-5">
      <PeriodNav
        title={`Week of ${shortDate(period.start)}`}
        subtitle={`${rangeLabel(period.start, period.end, { weekday: true })}${report.inProgress ? ` · so far, through ${shortDate(report.through, { weekday: true }).split(",")[0]}` : ""}`}
        prev={link(shiftPeriod(period, -1))}
        next={next.start <= current.start ? link(next) : null}
      >
        <Pill href={link(current)} active={period.start === current.start}>
          This week
        </Pill>
        <Pill href={link(last)} active={period.start === last.start}>
          Last week
        </Pill>
        <DateJump date={period.start} max={today} path="/admin/reports/week" omit={today} label="Pick a day in the week" />
      </PeriodNav>
      <PeriodView report={report} noun="week" boxOfficeHref={`/admin/reports/box-office?range=week&date=${period.start}`} />
    </div>
  );
}
