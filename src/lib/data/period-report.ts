import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "@/lib/ops/time";
import { datesIn, shiftPeriod, type Period } from "@/lib/report-periods";
import { countSubscriptionEnds } from "@/lib/membership-payments/read";
import { fetchAll, loadSales, salesByDay, summarizeSales, type Buckets, type SalesRows, type SalesSummary } from "./reports";

// Reports -> Week and Month: a stretch of business days added up with the
// Day report's own arithmetic (summarizeSales over the same rows), so each
// day here is exactly what the Day report shows for it, and the total is
// their sum (Insiders+ and gift memberships included, as their own part).
// Plus when the orders came in, members who joined, Insiders+ that ended,
// check-ins, and the same figures for the period before, to compare.

export interface PeriodDay {
  date: string;
  netSales: number;
  collected: number;
  orders: number;
  tickets: number;
  tips: number;
}

export interface MemberActivity {
  joined: number; // signed up here (the site or the register)
  imported: number; // moved over from the old site
  checkIns: number; // visits checked in at the door
  visitors: number; // different members among them
}

export interface PeriodTotals {
  sales: SalesSummary;
  members: MemberActivity | null; // null when the tables can't be read
  plusEnded: number | null; // Insiders+ subscriptions that ended (null: not tracked yet)
}

export interface PeriodReport extends PeriodTotals {
  period: Period;
  // The last business day counted: the period's end, or today while it's
  // still going (later days haven't happened).
  through: string;
  inProgress: boolean;
  days: PeriodDay[];
  // Finished orders by the hour they were rung up (Central clock, 0-23), in
  // business-day order from 4 a.m.
  hours: { hour: number; orders: number; sales: number }[];
  // The period before, cut at the same point when this one is still going
  // (so a Tuesday afternoon is compared with last Monday and Tuesday, up to
  // the same time).
  previous: PeriodTotals & { period: Period; through: string; partial: boolean };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function centralHour(iso: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
}

// Members who joined, and check-ins, between two instants. Best effort:
// null if a table can't be read, so the sales still show.
async function memberActivity(start: string, end: string, firstDate: string, lastDate: string): Promise<MemberActivity | null> {
  const supabase = createAdminClient();
  try {
    const [joined, imported, visits] = await Promise.all([
      supabase.from("members").select("id", { count: "exact", head: true }).is("legacy_user_id", null).gte("created_at", start).lt("created_at", end),
      supabase.from("members").select("id", { count: "exact", head: true }).not("legacy_user_id", "is", null).gte("created_at", start).lt("created_at", end),
      fetchAll<{ member_id: string }>((from, to) =>
        supabase.from("member_visits").select("member_id").gte("business_date", firstDate).lte("business_date", lastDate).lt("checked_in_at", end).order("id").range(from, to),
      ),
    ]);
    if (joined.error) throw joined.error;
    if (imported.error) throw imported.error;
    return { joined: joined.count ?? 0, imported: imported.count ?? 0, checkIns: visits.length, visitors: new Set(visits.map((v) => v.member_id)).size };
  } catch (e) {
    console.warn("member activity not read:", (e as PostgrestError).message ?? e);
    return null;
  }
}

async function totalsBetween(start: string, end: string, firstDate: string, lastDate: string): Promise<{ rows: SalesRows; totals: PeriodTotals; buckets: Buckets }> {
  const [{ rows, buckets }, members, plusEnded] = await Promise.all([loadSales(start, end), memberActivity(start, end, firstDate, lastDate), countSubscriptionEnds(start, end)]);
  return { rows, buckets, totals: { sales: summarizeSales(rows, buckets), members, plusEnded } };
}

export async function getPeriodReport(period: Period, now = new Date()): Promise<PeriodReport> {
  const today = businessDay(now).date;
  const inProgress = period.start <= today && today <= period.end;
  const through = inProgress ? today : period.end;
  const start = businessDayWindow(period.start).start;
  const end = businessDayWindow(through).end;

  // The period before, to the same point: as long as this one has run so far.
  const prevPeriod = shiftPeriod(period, -1);
  const prevStart = businessDayWindow(prevPeriod.start).start;
  const fullPrevEnd = businessDayWindow(prevPeriod.end).end;
  const elapsed = Math.min(now.getTime(), new Date(end).getTime()) - new Date(start).getTime();
  const cutPrevEnd = new Date(new Date(prevStart).getTime() + elapsed).toISOString();
  const prevEnd = inProgress && cutPrevEnd < fullPrevEnd ? cutPrevEnd : fullPrevEnd;
  const prevThrough = prevEnd === fullPrevEnd ? prevPeriod.end : businessDay(new Date(new Date(prevEnd).getTime() - 1)).date;

  const [cur, prev] = await Promise.all([totalsBetween(start, end, period.start, through), totalsBetween(prevStart, prevEnd, prevPeriod.start, prevThrough)]);

  const perDay = salesByDay(cur.rows);
  const days: PeriodDay[] = datesIn(period.start, through).map((date) => {
    const rows = perDay.get(date);
    if (!rows) return { date, netSales: 0, collected: 0, orders: 0, tickets: 0, tips: 0 };
    const s = summarizeSales(rows, cur.buckets);
    return { date, netSales: round2(s.netSales), collected: round2(s.collected), orders: s.orderCount, tickets: s.ticketsSold, tips: round2(s.tips) };
  });

  const byHour = new Map<number, { orders: number; sales: number }>();
  const hour = (iso: string) => {
    const h = centralHour(iso);
    let v = byHour.get(h);
    if (!v) byHour.set(h, (v = { orders: 0, sales: 0 }));
    return v;
  };
  for (const o of cur.rows.orders) {
    if (o.status !== "completed") continue;
    const h = hour(o.completed_at);
    h.orders++;
    h.sales += Number(o.total) - Number(o.tax) - Number(o.tip);
  }
  for (const p of cur.rows.partials) hour(p.orders.completed_at).sales -= Number(p.amount) - Number(p.tax_amount);
  // Every hour from the first order's to the last's (4 a.m. counts first), quiet ones too.
  const order = (h: number) => (h + 20) % 24;
  const seen = [...byHour.keys()].map(order);
  const hours = seen.length
    ? Array.from({ length: Math.max(...seen) - Math.min(...seen) + 1 }, (_, i) => {
        const h = (Math.min(...seen) + i + 4) % 24;
        const v = byHour.get(h);
        return { hour: h, orders: v?.orders ?? 0, sales: round2(v?.sales ?? 0) };
      })
    : [];

  return {
    period,
    through,
    inProgress,
    ...cur.totals,
    days,
    hours,
    previous: { period: prevPeriod, through: prevThrough, partial: prevEnd !== fullPrevEnd, ...prev.totals },
  };
}
