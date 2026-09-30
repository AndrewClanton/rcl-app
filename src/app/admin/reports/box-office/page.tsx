import { requireStaff } from "@/lib/auth";
import { getBoxOfficeReport } from "@/lib/data/box-office";
import { businessDay } from "@/lib/ops/time";
import { addDays, daysBetween, filmWeekOf, isDate, isMonth, monthOf, weekOf, type Period } from "@/lib/report-periods";
import BoxOfficeScreen from "./BoxOfficeScreen";

export const dynamic = "force-dynamic";

// Reports -> Box office: admissions and ticket money per movie and per
// showing, for the distributors. Counted by showing date; what's counted is
// in src/lib/data/box-office.ts.
//
// The address says which dates (so a link can be sent):
//   /admin/reports/box-office                       this film week (Fri-Thu)
//   ?date=2026-10-02                                the film week with that day
//   ?range=week&date=2026-09-28                     a calendar week (Mon-Sun)
//   ?range=month&month=2026-09                      a month
//   ?range=custom&from=2026-09-01&to=2026-09-15     any dates (up to a year)

type Params = { range?: string; date?: string; month?: string; from?: string; to?: string };

const MAX_DAYS = 366;

function periodFrom(p: Params, today: string): Period {
  if (p.range === "month") return monthOf(isMonth(p.month) ? p.month : today.slice(0, 7));
  if (p.range === "custom") {
    let from = isDate(p.from) ? p.from : filmWeekOf(today).start;
    let to = isDate(p.to) ? p.to : today;
    if (to < from) [from, to] = [to, from];
    if (daysBetween(from, to) >= MAX_DAYS) to = addDays(from, MAX_DAYS - 1);
    return { kind: "custom", start: from, end: to };
  }
  const date = isDate(p.date) ? p.date : today;
  return p.range === "week" ? weekOf(date) : filmWeekOf(date);
}

export default async function BoxOfficePage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const today = businessDay().date;
  const period = periodFrom(p, today);
  const [, report] = await Promise.all([requireStaff(), getBoxOfficeReport(period.start, period.end)]);
  return <BoxOfficeScreen report={report} period={period} today={today} />;
}
