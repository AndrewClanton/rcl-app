import { Suspense } from "react";
import Link from "next/link";
import InfoTip from "@/components/help/InfoTip";
import { clock, shiftDate } from "@/lib/ops/time";
import type { DayOrder, DayReport, RevenueDay } from "@/lib/data/reports";
import type { DayDrillData } from "@/lib/data/day-drill";
import { getCancelledTabs, getVoucherSales } from "@/lib/data/cancelled-tabs";
import { BOOTHS_LABEL, FOOD_AND_DRINK, TICKETS_LABEL } from "@/lib/report-categories";
import OrdersTable from "./OrdersTable";
import DateJump from "./DateJump";
import OrderSearch from "./OrderSearch";
import DayDrill from "./DayDrill";
import { BarList, Card, Columns, PeriodNav, Pill, Rows, SplitBar, Stat, TopItems, money, num } from "./ui";

// Reports -> Day, as drawn: the page (./page.tsx) checks the sign-in and
// reads the numbers. Every figure opens what's behind it (./DayDrill.tsx).

export const DAY_RANGES = [7, 30, 90];

function longDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

type Keep = { date?: string; days?: string };

function href(p: Keep) {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  const s = q.toString();
  return `/admin/reports${s ? `?${s}` : ""}`;
}

type Drill = { show: string; status?: string; pay?: string; cat?: string; item?: string };

export default function DayScreen({
  r,
  before,
  trend,
  date,
  today,
  days,
  orderNumber,
  found,
  drill,
  canRecord,
}: {
  r: DayReport;
  before: DayReport; // the same weekday a week earlier
  trend: RevenueDay[];
  date: string;
  today: string;
  days: number;
  orderNumber: number | null;
  found: DayOrder | null;
  drill: DayDrillData;
  canRecord: boolean; // managers and up record tip payouts
}) {
  const keep: Keep = { date: date === today ? undefined : date, days: days === 30 ? undefined : String(days) };
  const vs = `vs ${money(before.collected)} last ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;
  // This day with a drill-down open (and an order search kept, if any).
  // Just the query: it opens over this page, wherever it is.
  const to = (d: Drill) => {
    const q = new URLSearchParams(Object.entries({ ...keep, order: orderNumber ? String(orderNumber) : undefined, ...d }).filter(([, v]) => v) as [string, string][]);
    return `?${q.toString()}`;
  };
  const soldHref = (label: string) => (label === TICKETS_LABEL ? to({ show: "tickets" }) : label === BOOTHS_LABEL ? to({ show: "orders", pay: "online" }) : to({ show: "orders", cat: label }));
  const fullRefunds = r.orders.filter((o) => o.status === "refunded");

  return (
    <div className="space-y-5">
      <PeriodNav
        title={
          <>
            {date === today ? "Today" : longDate(date)}
            <InfoTip topic="business-day" />
          </>
        }
        subtitle={date === today ? longDate(date) : "4 a.m. to 4 a.m."}
        prev={href({ ...keep, date: shiftDate(date, -1) })}
        next={date < today ? href({ ...keep, date: shiftDate(date, 1) === today ? undefined : shiftDate(date, 1) }) : null}
      >
        {date !== today && <Pill href={href({ ...keep, date: undefined })}>Today</Pill>}
        <DateJump date={date} max={today} keep={{ days: keep.days }} />
        <OrderSearch key={orderNumber ?? "none"} initial={orderNumber ? String(orderNumber) : undefined} />
        <Link href={`/admin/reports/daily${keep.date ? `?date=${keep.date}` : ""}`} className="px-2 text-sm text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline">
          Daily email →
        </Link>
      </PeriodNav>

      {orderNumber !== null && (
        <Card
          title={`Order #${orderNumber}`}
          subtitle={found ? `Sold ${longDate(found.businessDate)}, shown below.` : undefined}
          action={
            <Link href={href({ ...keep })} className="text-[var(--muted)] hover:underline">
              Clear search
            </Link>
          }
          className="border-[var(--foreground)]"
        >
          <OrdersTable
            orders={found ? [found] : []}
            emptyText={`No finished order #${orderNumber}. Check the number on the receipt. Open tabs and held orders are on the register, not here.`}
          />
        </Card>
      )}

      <DayFigures r={r} before={before} vs={vs} to={to} paidOut={drill.payout !== null} trend={<TrendCard trend={trend} date={date} days={days} keep={keep} />} />

      {/* A computer: what sold, top items and where the money goes side by side. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="What sold" subtitle="Before tax and tips. Tap a line for the orders behind it.">
          {r.sold.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing sold this day.</p>
          ) : (
            <>
              <BarList rows={r.sold.map((s) => ({ label: s.label, value: s.amount, detail: s.detail, href: soldHref(s.label) }))} />
              <div className="mt-4">
                <Rows
                  rows={[
                    ...(r.discounts > 0 ? [{ label: "Member discounts", value: `−${money(r.discounts)}`, muted: true, href: to({ show: "net" }) }] : []),
                    ...(r.partialRefunds > 0 ? [{ label: "Given back in partial refunds", value: `−${money(r.partialRefunds)}`, muted: true, href: to({ show: "refunds" }) }] : []),
                    { label: "Net sales", value: money(r.netSales), strong: true, href: to({ show: "net" }) },
                    ...(fullRefunds.length > 0
                      ? [{ label: `Refunded in full · ${fullRefunds.length} (not counted)`, value: money(fullRefunds.reduce((s, o) => s + o.total, 0)), muted: true, href: to({ show: "refunds" }) }]
                      : []),
                  ]}
                />
              </div>
            </>
          )}
        </Card>

        <Card title="Top items">
          {r.topItems.length === 0 ? <p className="text-sm text-[var(--muted)]">Nothing sold this day.</p> : <TopItems items={r.topItems.map((it) => ({ ...it, href: to({ show: "orders", item: it.name }) }))} />}
        </Card>

        <Card title="Where the money goes" subtitle="Nathan's split. Each is its own rule, so they don't add up to sales." className="lg:col-span-2 xl:col-span-1">
          <Rows
            rows={r.accounts.map((a) => ({
              key: a.label,
              label: (
                <>
                  {a.label}
                  <div className="text-xs text-[var(--muted)]">{a.rule}</div>
                </>
              ),
              value: <span className="text-base font-semibold">{money(a.amount)}</span>,
              // The sales each rule is worked from.
              href: a.label === "Box office" ? to({ show: "tickets" }) : a.label === "Tax account" ? to({ show: "net" }) : to({ show: "orders", cat: FOOD_AND_DRINK }),
            }))}
          />
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not claimed by a rule: {money(r.unassigned)} (ticket and booth money past the $4, candy). The 20/80 food-and-drink split is still Nathan&apos;s &ldquo;maybe.&rdquo;
          </p>
        </Card>
      </div>

      <Card title={`Orders · ${r.orders.length}`}>
        <OrdersTable orders={r.orders} />
      </Card>

      <Suspense fallback={null}>
        <TabsAndVouchers date={date} />
      </Suspense>

      <Suspense fallback={null}>
        <DayDrill r={r} drill={drill} canRecord={canRecord} dayLabel={`${longDate(date)} · 4 a.m. to 4 a.m.`} />
      </Suspense>
    </div>
  );
}

// The day's numbers, how it was paid, and (`trend`) the days around it. A
// computer puts How it was paid and the trend side by side.
function DayFigures({ r, before, vs, to, paidOut, trend }: { r: DayReport; before: DayReport; vs: string; to: (d: Drill) => string; paidOut: boolean; trend: React.ReactNode }) {
  const avg = r.orderCount ? r.orderSales / r.orderCount : 0;
  const avgBefore = before.orderCount ? before.orderSales / before.orderCount : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="Collected" value={money(r.collected)} now={r.collected} before={before.collected} beforeText={vs} sub="cash, card and online, with tax and tips" href={to({ show: "collected" })} />
        <Stat label="Net sales" value={money(r.netSales)} now={r.netSales} before={before.netSales} href={to({ show: "net" })} />
        <Stat label="Orders" value={num(r.orderCount)} now={r.orderCount} before={before.orderCount} href={to({ show: "orders" })} />
        <Stat label="Tips" value={money(r.tips)} now={r.tips} before={before.tips} sub={r.tips > 0 ? (paidOut ? "paid out" : "not paid out yet") : undefined} href={to({ show: "tips" })} />
        <Stat label="Sales tax" value={money(r.tax)} href={to({ show: "tax" })} />
        <Stat label="Tickets" value={num(r.ticketsSold)} now={r.ticketsSold} before={before.ticketsSold} sub={r.tickets.free ? `${r.tickets.free} free` : undefined} href={to({ show: "tickets" })} />
        <Stat label="Average order" value={r.orderCount ? money(avg) : "—"} now={avg} before={avgBefore} sub="before tax and tip" href={to({ show: "orders" })} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card title="How it was paid" subtitle={r.vouchers > 0 ? "Vouchers (trivia prizes) paid for goods but brought in no money, so they aren't in Collected." : undefined}>
          <SplitBar
            parts={[
              { label: "Card", value: r.card, href: to({ show: "orders", pay: "card" }) },
              { label: "Cash", value: r.cash, href: to({ show: "orders", pay: "cash" }) },
              { label: "Online", value: r.online, href: to({ show: "orders", pay: "online" }) },
              { label: "Vouchers", value: r.vouchers, href: to({ show: "orders", pay: "vouchers" }) },
            ]}
          />
        </Card>
        {trend}
      </div>
    </div>
  );
}

// Tabs cancelled this day (kept on file, never a sale) and the voucher
// sales with the number on each voucher. Loaded on their own, so the rest
// of the day doesn't wait; each shows only when there's something in it.
async function TabsAndVouchers({ date }: { date: string }) {
  const [tabs, vouchers] = await Promise.all([getCancelledTabs(date), getVoucherSales(date)]);
  if (!tabs?.length && !vouchers?.length) return null;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {tabs && tabs.length > 0 && (
        <Card title={`Cancelled tabs · ${tabs.length}`} subtitle="Cancelled on the register with a manager PIN. Never paid, so they aren't in any figure above.">
          <ul className="divide-y divide-[var(--border)] text-sm">
            {tabs.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">#{t.orderNumber}</span>
                  {t.name && <span className="min-w-0 truncate">{t.name}</span>}
                  <span className="ml-auto tabular-nums text-[var(--muted)] line-through">{money(t.total)}</span>
                </div>
                {t.items && <p className="mt-0.5 line-clamp-2 text-[var(--muted)]">{t.items}</p>}
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Opened {clock(t.openedAt)}
                  {t.openedBy ? ` by ${t.openedBy}` : ""} · cancelled {clock(t.cancelledAt)}
                  {t.cancelledBy ? ` by ${t.cancelledBy}` : ""} · {t.approvedBy ? `approved by ${t.approvedBy}` : "approved with a shared manager PIN"}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {vouchers && vouchers.length > 0 && (
        <Card title={`Vouchers taken · ${vouchers.length}`} subtitle="Paper vouchers (trivia prizes), with the number on the voucher when the cashier typed it.">
          <Rows
            rows={vouchers.map((v) => ({
              key: v.id,
              label: (
                <>
                  #{v.orderNumber} <span className="text-[var(--muted)]">· {clock(v.at)}</span>
                  <div className="text-xs text-[var(--muted)]">
                    {v.code ? `Voucher #${v.code}` : "No voucher number typed"}
                    {v.status === "refunded" ? " · refunded" : ""}
                  </div>
                </>
              ),
              value: money(v.voucher),
              muted: v.status === "refunded",
            }))}
          />
        </Card>
      )}
    </div>
  );
}

// Money in per day. Each bar opens that day; the picked day is in ink.
function TrendCard({ trend, date, days, keep }: { trend: RevenueDay[]; date: string; days: number; keep: Keep }) {
  const total = trend.reduce((s, d) => s + d.total, 0);
  const open = trend.filter((d) => d.total > 0).length;
  const last = trend[trend.length - 1]?.date;
  return (
    <Card
      title={`Last ${days} days`}
      subtitle={
        <>
          {money(total)} collected{open > 0 && <> · {money(total / open)} per day open</>}
        </>
      }
      action={
        <span className="flex gap-1">
          {DAY_RANGES.map((n) => (
            <Pill key={n} href={href({ ...keep, days: n === 30 ? undefined : String(n) })} active={n === days}>
              {n}d
            </Pill>
          ))}
        </span>
      }
    >
      <Columns
        height={96}
        labelEvery={days <= 7 ? 1 : days <= 30 ? 7 : 30}
        columns={trend.map((d) => ({
          key: d.date,
          label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", days <= 7 ? { weekday: "short", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" }),
          value: d.total,
          strong: d.date === date,
          title: `${longDate(d.date)}: ${money(d.total)}${d.online ? ` (${money(d.online)} online)` : ""}`,
          href: href({ ...keep, date: d.date === last ? undefined : d.date }),
        }))}
        emptyText="Nothing collected in these days."
      />
    </Card>
  );
}
