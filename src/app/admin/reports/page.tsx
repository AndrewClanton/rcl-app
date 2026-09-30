import { redirect } from "next/navigation";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import { getDayReport, getRevenueTrend, getOrderByNumber } from "@/lib/data/reports";
import { getDayDrill } from "@/lib/data/day-drill";
import { businessDay, shiftDate } from "@/lib/ops/time";
import DayScreen, { DAY_RANGES } from "./DayScreen";

export const dynamic = "force-dynamic";

// Reports -> Day: how one business day went, 4 a.m. to 4 a.m. Central,
// compared with the same weekday a week before. The other reports have
// their own tabs (./layout.tsx); the old ?view=tax|bar|members addresses
// are sent there.

type Params = { view?: string; date?: string; days?: string; order?: string; period?: string };

export default async function DayReportPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  if (p.view === "tax") redirect(`/admin/reports/tax${p.period ? `?period=${encodeURIComponent(p.period)}` : ""}`);
  if (p.view === "bar") redirect(`/admin/reports/bar${p.days ? `?days=${encodeURIComponent(p.days)}` : ""}`);
  if (p.view === "members") redirect("/admin/reports/members");

  const today = businessDay().date;
  // Order search (?order=7851): the order, and its day below it.
  const orderNumber = p.order && /^\d{1,12}$/.test(p.order) ? Number(p.order) : null;
  const [staff, found] = await Promise.all([requireStaff(), orderNumber ? getOrderByNumber(orderNumber) : null]);
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= today ? p.date : (found?.businessDate ?? today);
  const days = DAY_RANGES.includes(Number(p.days)) ? Number(p.days) : 30;

  const [r, before, trend] = await Promise.all([getDayReport(date), getDayReport(shiftDate(date, -7)), getRevenueTrend(days)]);
  // What's behind each figure (shifts, refund approvers, showings, the tip payout), for the drill-downs.
  const drill = await getDayDrill(r);
  return <DayScreen r={r} before={before} trend={trend} date={date} today={today} days={days} orderNumber={orderNumber} found={found} drill={drill} canRecord={hasManagerAccess(staff.role)} />;
}
