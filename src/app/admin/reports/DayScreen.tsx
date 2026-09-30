import Link from "next/link";
import { shiftDate } from "@/lib/ops/time";
import type { DayOrder, DayReport, RevenueDay } from "@/lib/data/reports";
import OrdersTable from "./OrdersTable";
import DateJump from "./DateJump";
import OrderSearch from "./OrderSearch";
import { BarList, Card, Columns, PeriodNav, Pill, Rows, SplitBar, Stat, TopItems, money, num } from "./ui";

// Reports -> Day, as drawn: the page (./page.tsx) checks the sign-in and
// reads the numbers.

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

export default function DayScreen({
  r,
  before,
  trend,
  date,
  today,
  days,
  orderNumber,
  found,
}: {
  r: DayReport;
  before: DayReport; // the same weekday a week earlier
  trend: RevenueDay[];
  date: string;
  today: string;
  days: number;
  orderNumber: number | null;
  found: DayOrder | null;
}) {
  const keep: Keep = { date: date === today ? undefined : date, days: days === 30 ? undefined : String(days) };
  const vs = `vs ${money(before.collected)} last ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;

  return (
    <div className="space-y-5">
      <PeriodNav
        title={date === today ? "Today" : longDate(date)}
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

      <DayFigures r={r} before={before} vs={vs} />

      <TrendCard trend={trend} date={date} days={days} keep={keep} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="What sold" subtitle="Before tax and tips.">
          {r.sold.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing sold this day.</p>
          ) : (
            <>
              <BarList rows={r.sold.map((s) => ({ label: s.label, value: s.amount, detail: s.detail }))} />
              <div className="mt-4">
                <Rows
                  rows={[
                    ...(r.discounts > 0 ? [{ label: "Member discounts", value: `−${money(r.discounts)}`, muted: true }] : []),
                    ...(r.partialRefunds > 0 ? [{ label: "Given back in partial refunds", value: `−${money(r.partialRefunds)}`, muted: true }] : []),
                    { label: "Net sales", value: money(r.netSales), strong: true },
                  ]}
                />
              </div>
            </>
          )}
        </Card>

        <Card title="Top items">
          {r.topItems.length === 0 ? <p className="text-sm text-[var(--muted)]">Nothing sold this day.</p> : <TopItems items={r.topItems} />}
        </Card>
      </div>

      <Card title="Where the money goes" subtitle="Nathan's split. Each is its own rule, so they don't add up to sales.">
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
          }))}
        />
        <p className="mt-2 text-xs text-[var(--muted)]">
          Not claimed by a rule: {money(r.unassigned)} (ticket and booth money past the $4, candy). The 20/80 food-and-drink split is still Nathan&apos;s &ldquo;maybe.&rdquo;
        </p>
      </Card>

      <Card title={`Orders · ${r.orders.length}`}>
        <OrdersTable orders={r.orders} />
      </Card>
    </div>
  );
}

function DayFigures({ r, before, vs }: { r: DayReport; before: DayReport; vs: string }) {
  const avg = r.orderCount ? r.orderSales / r.orderCount : 0;
  const avgBefore = before.orderCount ? before.orderSales / before.orderCount : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="Collected" value={money(r.collected)} now={r.collected} before={before.collected} beforeText={vs} sub="cash, card and online, with tax and tips" />
        <Stat label="Net sales" value={money(r.netSales)} now={r.netSales} before={before.netSales} />
        <Stat label="Orders" value={num(r.orderCount)} now={r.orderCount} before={before.orderCount} />
        <Stat label="Tips" value={money(r.tips)} now={r.tips} before={before.tips} />
        <Stat label="Sales tax" value={money(r.tax)} />
        <Stat label="Tickets" value={num(r.ticketsSold)} now={r.ticketsSold} before={before.ticketsSold} sub={r.tickets.free ? `${r.tickets.free} free` : undefined} />
        <Stat label="Average order" value={r.orderCount ? money(avg) : "—"} now={avg} before={avgBefore} sub="before tax and tip" />
      </div>
      <Card title="How it was paid" subtitle={r.vouchers > 0 ? "Vouchers (trivia prizes) paid for goods but brought in no money, so they aren't in Collected." : undefined}>
        <SplitBar
          parts={[
            { label: "Card", value: r.card },
            { label: "Cash", value: r.cash },
            { label: "Online", value: r.online },
            { label: "Vouchers", value: r.vouchers },
          ]}
        />
      </Card>
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
