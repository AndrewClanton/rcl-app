import { Suspense } from "react";
import Link from "next/link";
import InfoTip from "@/components/help/InfoTip";
import { shiftDate } from "@/lib/ops/time";
import type { DayOrder, DayReport, RevenueDay } from "@/lib/data/reports";
import type { DayDrillData } from "@/lib/data/day-drill";
import type { PaymentSyncStatus } from "@/lib/membership-payments/read";
import { BOOTHS_LABEL, FOOD_AND_DRINK, MEMBERSHIPS_LABEL, TICKETS_LABEL } from "@/lib/report-categories";
import { DAILY_COFFEE_LINE } from "@/lib/daily-perk";
import { ownerRateLine } from "@/lib/register-totals";
import MembershipsCard from "./MembershipsCard";
import OrdersTable from "./OrdersTable";
import DateJump from "./DateJump";
import OrderSearch from "./OrderSearch";
import DayDrill from "./DayDrill";
import { TaxFreeCallout, TaxFreeOrdersCard } from "./TaxFreeOrders";
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
  sync,
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
  sync: PaymentSyncStatus; // when member payments were last read from Stripe
}) {
  const keep: Keep = { date: date === today ? undefined : date, days: days === 30 ? undefined : String(days) };
  const lastWeekday = `last ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}`;
  const vs = `vs ${money(before.collected)} ${lastWeekday}`;
  // This day with a drill-down open (and an order search kept, if any).
  // Just the query: it opens over this page, wherever it is.
  const to = (d: Drill) => {
    const q = new URLSearchParams(Object.entries({ ...keep, order: orderNumber ? String(orderNumber) : undefined, ...d }).filter(([, v]) => v) as [string, string][]);
    return `?${q.toString()}`;
  };
  const soldHref = (label: string) =>
    label === TICKETS_LABEL
      ? to({ show: "tickets" })
      : label === BOOTHS_LABEL
        ? to({ show: "orders", pay: "online" })
        : label === MEMBERSHIPS_LABEL
          ? to({ show: "memberships" })
          : to({ show: "orders", cat: label });
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

      <TaxFreeCallout orders={r.taxFreeOrders} when={date === today ? "today" : "this day"} />

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
                    ...(r.dailyCoffee > 0 ? [{ label: `${DAILY_COFFEE_LINE} · ${r.dailyCoffeeCount}`, value: `−${money(r.dailyCoffee)}`, muted: true, href: to({ show: "net" }) }] : []),
                    ...(r.orgComps > 0 ? [{ label: `Organization comps · ${r.orgCompOrders}`, value: `−${money(r.orgComps)}`, muted: true, href: "/admin/reports/organizations" }] : []),
                    ...(r.taxIncluded.tax > 0
                      ? [{ label: `Tax inside even-dollar sales · ${r.taxIncluded.orders} (${money(r.taxIncluded.sales)})`, value: `−${money(r.taxIncluded.tax)}`, muted: true }]
                      : []),
                    ...(r.partialRefunds > 0 ? [{ label: "Given back in partial refunds", value: `−${money(r.partialRefunds)}`, muted: true, href: to({ show: "refunds" }) }] : []),
                    { label: "Net sales", value: money(r.netSales), strong: true, href: to({ show: "net" }) },
                    // Not taken off: the owner-rate sales are already at what the owners paid.
                    ...(r.ownerRate.orders > 0
                      ? [
                          {
                            label: `${ownerRateLine(r.ownerRate).label} (${ownerRateLine(r.ownerRate).who})`,
                            value: ownerRateLine(r.ownerRate).value,
                            muted: true,
                            href: to({ show: "orders", pay: "owner" }),
                          },
                        ]
                      : []),
                    ...(fullRefunds.length > 0
                      ? [{ label: `Refunded in full · ${fullRefunds.length} (not counted${fullRefunds.some((o) => o.ownerTab) ? `; ${fullRefunds.filter((o) => o.ownerTab).length} taken off owner tab` : ""})`, value: money(fullRefunds.reduce((s, o) => s + o.total, 0)), muted: true, href: to({ show: "refunds" }) }]
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
            Not claimed by a rule: {money(r.unassigned)} (ticket and booth money past the $4, candy, memberships{r.ownerTab.sales > 0 ? ", the owner tab" : ""}). The 20/80
            food-and-drink split is still Nathan&apos;s &ldquo;maybe.&rdquo;
          </p>
        </Card>
      </div>

      <MembershipsCard m={r.memberships} before={before.memberships} prevName={lastWeekday} sync={sync} href={() => to({ show: "memberships" })} />

      <TaxFreeOrdersCard orders={r.taxFreeOrders} />

      <Card title={`Orders · ${r.orders.length}`}>
        <OrdersTable orders={r.orders} />
      </Card>

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
        <Stat
          hero
          className="col-span-2"
          label="Collected"
          value={money(r.collected)}
          now={r.collected}
          before={before.collected}
          beforeText={vs}
          sub={`${r.memberships.collected !== 0 ? `cash, card, online and ${money(r.memberships.collected)} in memberships` : "cash, card, online and memberships"}${
            r.ownerTab.paid !== 0 ? `, plus ${money(r.ownerTab.paid)} of owner tab payments` : ""
          }, with tax and tips${r.giftCardsSold > 0 ? `; ${money(r.giftCardsSold)} of gift cards sold is owed, not counted` : ""}`}
          href={to({ show: "collected" })}
        />
        <Stat label="Net sales" value={money(r.netSales)} now={r.netSales} before={before.netSales} href={to({ show: "net" })} />
        <Stat label="Orders" value={num(r.orderCount)} now={r.orderCount} before={before.orderCount} href={to({ show: "orders" })} />
        <Stat label="Tips" value={money(r.tips)} now={r.tips} before={before.tips} sub={r.tips > 0 ? (paidOut ? "paid out" : "not paid out yet") : undefined} href={to({ show: "tips" })} />
        <Stat label="Sales tax" value={money(r.tax)} sub={r.ownerTab.tax > 0 ? `${money(r.ownerTab.tax)} of it owed on owner tabs` : undefined} href={to({ show: "tax" })} />
        <Stat label="Tickets" value={num(r.ticketsSold)} now={r.ticketsSold} before={before.ticketsSold} sub={r.tickets.free ? `${r.tickets.free} free` : undefined} href={to({ show: "tickets" })} />
        <Stat label="Average order" value={r.orderCount ? money(avg) : "—"} now={avg} before={avgBefore} sub="before tax and tip" href={to({ show: "orders" })} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card
          title="How it was paid"
          subtitle={
            [
              r.vouchers > 0 ? "Vouchers (trivia prizes) paid for goods but brought in no money, so they aren't in Collected." : "",
              r.giftCardsSold > 0 ? `Gift cards sold (owed): ${money(r.giftCardsSold)}. Card and cash below include it; Collected doesn't, since it's counted as sales when the cards are spent.` : "",
              r.giftCardsUsed > 0 ? "Gift cards spent brought in no money today (it came in when each card was sold), so they aren't in Collected." : "",
              r.ownerTab.owed > 0 ? `${money(r.ownerTab.owed)} went on owner tabs: it's money in when an owner pays their monthly statement, not before.` : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <SplitBar
            parts={[
              { label: "Card", value: r.card, href: to({ show: "orders", pay: "card" }) },
              { label: "Cash", value: r.cash, href: to({ show: "orders", pay: "cash" }) },
              { label: "Online", value: r.online, href: to({ show: "orders", pay: "online" }) },
              { label: "Memberships", value: r.memberships.collected, href: to({ show: "memberships" }) },
              { label: "Vouchers", value: r.vouchers, href: to({ show: "orders", pay: "vouchers" }) },
              { label: "Gift cards", value: r.giftCardsUsed, href: "/admin/gift-cards" },
              { label: "Owner tab payments", value: r.ownerTab.paid, href: to({ show: "collected" }) },
            ]}
          />
        </Card>
        {trend}
      </div>
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
          title: `${longDate(d.date)}: ${money(d.total)}${d.online || d.memberships || d.ownerTab ? ` (${[d.online ? `${money(d.online)} online` : "", d.memberships ? `${money(d.memberships)} memberships` : "", d.ownerTab ? `${money(d.ownerTab)} owner tab payments` : ""].filter(Boolean).join(", ")})` : ""}`,
          href: href({ ...keep, date: d.date === last ? undefined : d.date }),
        }))}
        emptyText="Nothing collected in these days."
      />
    </Card>
  );
}
