import { requireStaff } from "@/lib/auth";
import { getPeriodReport } from "@/lib/data/period-report";
import { businessDay } from "@/lib/ops/time";
import { isMonth, monthLabel, monthOf, rangeLabel, shiftMonth } from "@/lib/report-periods";
import { ensureMemberPaymentsFresh } from "@/lib/membership-payments/sync";
import { getPaymentSyncStatus } from "@/lib/membership-payments/read";
import DateJump from "../DateJump";
import PeriodView from "../PeriodView";
import { PeriodNav, Pill } from "../ui";

export const dynamic = "force-dynamic";

// Reports -> Month. ?month=2026-09; no month is this month.
export default async function MonthReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams;
  const today = businessDay().date;
  const thisMonth = today.slice(0, 7);
  const month = isMonth(asked) && asked <= thisMonth ? asked : thisMonth;
  const period = monthOf(month);
  await requireStaff();
  // Membership payments are read from Stripe first if it's been a while.
  await ensureMemberPaymentsFresh();
  const [report, sync] = await Promise.all([getPeriodReport(period), getPaymentSyncStatus()]);

  const link = (m: string) => (m === thisMonth ? "/admin/reports/month" : `/admin/reports/month?month=${m}`);
  const next = shiftMonth(month, 1);
  const lastMonth = shiftMonth(thisMonth, -1);

  return (
    <div className="space-y-5">
      <PeriodNav
        title={monthLabel(month)}
        subtitle={report.inProgress ? `So far: ${rangeLabel(period.start, report.through)}` : rangeLabel(period.start, period.end)}
        prev={link(shiftMonth(month, -1))}
        next={next <= thisMonth ? link(next) : null}
      >
        <Pill href={link(thisMonth)} active={month === thisMonth}>
          This month
        </Pill>
        <Pill href={link(lastMonth)} active={month === lastMonth}>
          Last month
        </Pill>
        <DateJump type="month" param="month" date={month} max={thisMonth} path="/admin/reports/month" label="Pick a month" />
      </PeriodNav>
      <PeriodView report={report} noun="month" boxOfficeHref={`/admin/reports/box-office?range=month&month=${month}`} sync={sync} />
    </div>
  );
}
