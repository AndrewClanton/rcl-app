import Link from "next/link";
import {
  getDayReport,
  getRevenueTrend,
  getMembershipAnalytics,
  getAlcoholUsageReport,
  getPourCostReport,
  getOrderByNumber,
  getSalesTaxReport,
  expectedTax,
  type RevenueDay,
  type TaxMonth,
} from "@/lib/data/reports";
import { businessDay, shiftDate } from "@/lib/ops/time";
import OrdersTable from "./OrdersTable";
import DateJump from "./DateJump";
import OrderSearch from "./OrderSearch";

export const dynamic = "force-dynamic";

// One screen per question: "how did a day go" (Day, the default), "are
// drinks costing what they should" (Bar costs), "who are our members"
// (Members), "what do we owe the state" (Sales tax). Everything on Day is
// for the one business day picked, 4 a.m. to 4 a.m. Central.

const RANGES = [7, 30, 90];

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function longDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

type Params = { view?: string; date?: string; days?: string; order?: string; period?: string };

function href(p: Params) {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  const s = q.toString();
  return `/admin/reports${s ? `?${s}` : ""}`;
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const view = p.view === "bar" || p.view === "members" || p.view === "tax" ? p.view : "day";
  const today = businessDay().date;
  // Order search (?order=7851): the order, and its day below it.
  const orderNumber = view === "day" && p.order && /^\d{1,12}$/.test(p.order) ? Number(p.order) : null;
  const found = orderNumber ? await getOrderByNumber(orderNumber) : null;
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date <= today ? p.date : (found?.businessDate ?? today);
  const days = RANGES.includes(Number(p.days)) ? Number(p.days) : 30;
  const keep = { date: date === today ? undefined : date, days: days === 30 ? undefined : String(days) };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-lg font-semibold">Reports</h1>
        {[
          ["day", "Day"],
          ["bar", "Bar costs"],
          ["members", "Members"],
          ["tax", "Sales tax"],
        ].map(([v, label]) => (
          <Link key={v} href={href({ ...keep, view: v === "day" ? undefined : v })} className={`chip !px-3 !py-1 !text-sm ${view === v ? "chip-selected font-bold" : ""}`}>
            {label}
          </Link>
        ))}
        <Link href={`/admin/reports/daily${keep.date ? `?date=${keep.date}` : ""}`} className="ml-auto text-sm text-[var(--accent)] hover:underline">
          Daily email →
        </Link>
      </div>
      {view === "day" && <DayView date={date} today={today} days={days} keep={keep} orderNumber={orderNumber} found={found} />}
      {view === "bar" && <BarView days={days} keep={keep} />}
      {view === "members" && <MembersView />}
      {view === "tax" && <TaxView period={p.period} today={today} />}
    </div>
  );
}

// ---------- Day ----------

async function DayView({
  date,
  today,
  days,
  keep,
  orderNumber,
  found,
}: {
  date: string;
  today: string;
  days: number;
  keep: Params;
  orderNumber: number | null;
  found: Awaited<ReturnType<typeof getOrderByNumber>>;
}) {
  const [r, trend] = await Promise.all([getDayReport(date), getRevenueTrend(days)]);
  const completed = r.orders.filter((o) => o.status === "completed").length;

  return (
    <>
      {orderNumber !== null && (
        <section className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Order #{orderNumber}</h3>
            {found && <span className="text-xs text-[var(--muted)]">sold {longDate(found.businessDate)}, shown below</span>}
            <Link href={href({ ...keep })} className="ml-auto text-xs text-[var(--muted)] hover:underline">
              Clear search
            </Link>
          </div>
          <OrdersTable
            orders={found ? [found] : []}
            emptyText={`No finished order #${orderNumber}. Check the number on the receipt. Open tabs and held orders are on the register, not here.`}
          />
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ ...keep, date: shiftDate(date, -1) })} className="chip !px-2.5 !py-1 !text-sm" aria-label="Previous day">
          ◀
        </Link>
        <h2 className="min-w-[11rem] text-center text-base font-semibold">{date === today ? `Today · ${longDate(date)}` : longDate(date)}</h2>
        {date < today ? (
          <Link href={href({ ...keep, date: shiftDate(date, 1) === today ? undefined : shiftDate(date, 1) })} className="chip !px-2.5 !py-1 !text-sm" aria-label="Next day">
            ▶
          </Link>
        ) : (
          <span className="chip !px-2.5 !py-1 !text-sm opacity-30">▶</span>
        )}
        {date !== today && (
          <Link href={href({ ...keep, date: undefined })} className="chip !px-3 !py-1 !text-sm">
            Today
          </Link>
        )}
        <DateJump date={date} max={today} days={keep.days} />
        <span className="ml-auto">
          <OrderSearch key={orderNumber ?? "none"} initial={orderNumber ? String(orderNumber) : undefined} />
        </span>
      </div>

      <TrendStrip trend={trend} date={date} days={days} keep={keep} />

      {/* The day in one line: money in, and how it arrived. */}
      <div className={`grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-4 ${r.vouchers > 0 ? "lg:grid-cols-9" : "lg:grid-cols-8"}`}>
        {[
          ["Collected", money(r.collected), true],
          ["Cash", money(r.cash)],
          ["Card", money(r.card)],
          ["Online", money(r.online)],
          ["Tips", money(r.tips)],
          ["Sales tax", money(r.tax)],
          ...(r.vouchers > 0 ? [["Vouchers used", money(r.vouchers)]] : []),
          ["Orders", String(completed)],
          ["Tickets", String(r.ticketsSold)],
        ].map(([label, value, strong]) => (
          <div key={label as string} className="border-b border-r border-[var(--border)] px-3 py-2 -mb-px -mr-px">
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
            <div className={`tabular-nums ${strong ? "text-lg font-bold text-[var(--accent)]" : "text-base font-semibold"}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold">What sold</h3>
          {r.sold.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing sold this day.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <tbody>
                {r.sold.map((s) => (
                  <tr key={s.label}>
                    <td className="py-0.5">
                      {s.label}
                      {s.detail && <span className="ml-1.5 text-xs text-[var(--muted)]">{s.detail}</span>}
                    </td>
                    <td className="py-0.5 text-right">{money(s.amount)}</td>
                  </tr>
                ))}
                {r.discounts > 0 && (
                  <tr className="text-[var(--muted)]">
                    <td className="py-0.5">Member discounts</td>
                    <td className="py-0.5 text-right">−{money(r.discounts)}</td>
                  </tr>
                )}
                {r.partialRefunds > 0 && (
                  <tr className="text-[var(--muted)]">
                    <td className="py-0.5">Given back in partial refunds</td>
                    <td className="py-0.5 text-right">−{money(r.partialRefunds)}</td>
                  </tr>
                )}
                <tr className="border-t border-[var(--border)] font-semibold">
                  <td className="pt-1">Net sales</td>
                  <td className="pt-1 text-right">{money(r.netSales)}</td>
                </tr>
              </tbody>
            </table>
          )}

          {r.topItems.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-semibold">Top items</h3>
              <table className="w-full text-sm tabular-nums">
                <tbody>
                  {r.topItems.map((it) => (
                    <tr key={it.name} className="align-top">
                      <td className="w-8 py-0.5 text-[var(--muted)]">{it.qty}×</td>
                      <td className="py-0.5">
                        {it.name}
                        {it.options && <div className="text-xs text-[var(--muted)]">{it.options}</div>}
                      </td>
                      <td className="py-0.5 text-right">{money(it.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold">Where the money goes</h3>
          <p className="mb-2 text-xs text-[var(--muted)]">Nathan&apos;s split. Each is its own rule, so they don&apos;t add up to sales.</p>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {r.accounts.map((a) => (
                <tr key={a.label}>
                  <td className="py-1">
                    {a.label}
                    <div className="text-xs text-[var(--muted)]">{a.rule}</div>
                  </td>
                  <td className="py-1 text-right text-base font-semibold">{money(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not claimed by a rule: {money(r.unassigned)} (ticket and booth money past the $4, candy). The 20/80 food-and-drink split is still Nathan&apos;s &ldquo;maybe.&rdquo;
          </p>
        </section>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="mb-2 text-sm font-semibold">
          Orders <span className="font-normal text-[var(--muted)]">· {r.orders.length}</span>
        </h3>
        <OrdersTable orders={r.orders} />
      </section>
    </>
  );
}

// Money in per day. Each bar opens that day; the picked day is highlighted.
function TrendStrip({ trend, date, days, keep }: { trend: RevenueDay[]; date: string; days: number; keep: Params }) {
  const max = Math.max(1, ...trend.map((d) => d.total));
  const total = trend.reduce((s, d) => s + d.total, 0);
  const open = trend.filter((d) => d.total > 0).length;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 pb-2 pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
        <span>
          Last {days} days: <strong className="text-[var(--foreground)]">{money(total)}</strong>
          {open > 0 && <> · {money(total / open)} per day open</>}
        </span>
        <span className="ml-auto flex gap-1">
          {RANGES.map((n) => (
            <Link key={n} href={href({ ...keep, days: n === 30 ? undefined : String(n) })} className={`chip !px-2 !py-0.5 ${n === days ? "chip-selected font-bold" : ""}`}>
              {n}d
            </Link>
          ))}
        </span>
      </div>
      <div className="flex h-14 items-end gap-px">
        {trend.map((d) => (
          <Link
            key={d.date}
            href={href({ ...keep, date: d.date === trend[trend.length - 1].date ? undefined : d.date })}
            title={`${longDate(d.date)}: ${money(d.total)}${d.online ? ` (${money(d.online)} online)` : ""}`}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <span
              className="block w-full rounded-t-sm"
              style={{
                height: d.total > 0 ? `${Math.max(4, (d.total / max) * 100)}%` : "2px",
                background: d.date === date ? "var(--accent)" : "var(--border)",
              }}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------- Bar costs ----------

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

async function BarView({ days, keep }: { days: number; keep: Params }) {
  const [usage, pour] = await Promise.all([getAlcoholUsageReport(days), getPourCostReport()]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold">Pour cost by drink</h3>
        <p className="mb-2 text-xs text-[var(--muted)]">Ingredient cost ÷ menu price. Bars aim for 16–20%; red is over 20%.</p>
        {pour.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No drinks on the menu yet.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1 font-medium">Drink</th>
                <th className="pb-1 text-right font-medium">Price</th>
                <th className="pb-1 text-right font-medium">Cost</th>
                <th className="pb-1 text-right font-medium">Pour</th>
              </tr>
            </thead>
            <tbody>
              {pour.map((row) => (
                <tr key={row.menuItemId} className="border-t border-[var(--border)]">
                  <td className="py-1">{row.name}</td>
                  <td className="py-1 text-right">{money(row.price)}</td>
                  <td className="py-1 text-right text-[var(--muted)]">{row.ingredientCost === null ? "—" : money(row.ingredientCost)}</td>
                  <td className={`py-1 text-right font-medium ${row.pourCostPct !== null && row.pourCostPct > 0.2 ? "text-[var(--danger-text)]" : ""}`}>
                    {row.pourCostPct === null ? <span className="text-xs font-normal text-[var(--muted)]">needs costs</span> : `${(row.pourCostPct * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Pours vs. counts</h3>
          <span className="ml-auto flex gap-1 text-xs">
            {RANGES.map((n) => (
              <Link key={n} href={href({ ...keep, view: "bar", days: n === 30 ? undefined : String(n) })} className={`chip !px-2 !py-0.5 ${n === days ? "chip-selected font-bold" : ""}`}>
                {n}d
              </Link>
            ))}
          </span>
        </div>
        <p className="mb-2 text-xs text-[var(--muted)]">What recipes say was poured vs. what the shelf counts say left. Red means more left the shelf than was rung up.</p>
        {usage.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No ingredients yet. Add them on the Ingredients page.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1 font-medium">Ingredient</th>
                <th className="pb-1 text-right font-medium">Rung up</th>
                <th className="pb-1 text-right font-medium">Counted</th>
                <th className="pb-1 text-right font-medium">Over</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((row) => {
                const over = row.variance !== null && row.variance > 0;
                return (
                  <tr key={row.ingredientId} className="border-t border-[var(--border)]">
                    <td className="py-1">{row.name}</td>
                    <td className="py-1 text-right">
                      {row.theoreticalUsage.toFixed(1)} {unitLabel(row.unit)}
                    </td>
                    <td className="py-1 text-right text-[var(--muted)]">{row.physicalUsage === null ? "—" : `${row.physicalUsage.toFixed(1)} ${unitLabel(row.unit)}`}</td>
                    <td className={`py-1 text-right ${over ? "font-medium text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>
                      {row.variance === null ? "—" : row.varianceCost !== null ? `${row.varianceCost > 0 ? "+" : ""}${money(row.varianceCost)}` : `${row.variance > 0 ? "+" : ""}${row.variance.toFixed(1)} ${unitLabel(row.unit)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">&ldquo;Counted&rdquo; needs two shelf counts around the range (Ingredients page).</p>
      </section>
    </div>
  );
}

// ---------- Members ----------

async function MembersView() {
  const m = await getMembershipAnalytics();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="mb-2 text-sm font-semibold">Members</h3>
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {[
              ["All members", m.total],
              ["Insiders (free)", m.insiders],
              ["Insiders+ paying", m.payingInsidersPlus],
              ["Insiders+ not billed", m.insidersPlus - m.payingInsidersPlus],
              ["Free through a community program", m.compedMembers],
              ["Joined this month", m.newThisMonth],
            ].map(([label, n]) => (
              <tr key={label as string} className="border-t border-[var(--border)] first:border-0">
                <td className="py-1">{label}</td>
                <td className="py-1 text-right font-semibold">{(n as number).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold">Free members by community program</h3>
        <p className="mb-2 text-xs text-[var(--muted)]">For grant and impact reporting.</p>
        {m.byProgram.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No community-program members yet.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {m.byProgram.map(({ program, count }) => (
                <tr key={program} className="border-t border-[var(--border)] first:border-0">
                  <td className="py-1">{program}</td>
                  <td className="py-1 text-right font-semibold">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ---------- Sales tax ----------
// Sales tax collected for the Missouri return, by month or by quarter.
// Figures come from src/lib/data/reports.ts (getSalesTaxReport), which
// says what's counted and how refunds are handled.

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

function quarterOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

function shiftQuarter(period: string, n: number) {
  const [y, q] = period.split("-Q").map(Number);
  const i = y * 4 + (q - 1) + n;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
}

async function TaxView({ period: asked, today }: { period?: string; today: string }) {
  const thisMonth = today.slice(0, 7);
  const thisQuarter = quarterOf(thisMonth);
  const wanted = asked && asked <= (asked.includes("Q") ? thisQuarter : thisMonth) ? asked : thisMonth;
  const report = (await getSalesTaxReport(wanted)) ?? (await getSalesTaxReport(thisMonth))!;
  const isQuarter = report.period.includes("Q");
  const prev = isQuarter ? shiftQuarter(report.period, -1) : shiftMonth(report.period, -1);
  const next = isQuarter ? shiftQuarter(report.period, 1) : shiftMonth(report.period, 1);
  const hasNext = isQuarter ? next <= thisQuarter : next <= thisMonth;
  const t = report.total;
  const taxable = t.sales - t.exemptSales;
  const expected = expectedTax(t);
  const taxHref = (period: string) => href({ view: "tax", period: period === thisMonth ? undefined : period });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={taxHref(prev)} className="chip !px-2.5 !py-1 !text-sm" aria-label="Earlier">
          ◀
        </Link>
        <h2 className="min-w-[11rem] text-center text-base font-semibold">{report.label}</h2>
        {hasNext ? (
          <Link href={taxHref(next)} className="chip !px-2.5 !py-1 !text-sm" aria-label="Later">
            ▶
          </Link>
        ) : (
          <span className="chip !px-2.5 !py-1 !text-sm opacity-30">▶</span>
        )}
        <span className="ml-2 flex flex-wrap gap-1">
          {[
            [thisMonth, "This month"],
            [shiftMonth(thisMonth, -1), "Last month"],
            [thisQuarter, "This quarter"],
            [shiftQuarter(thisQuarter, -1), "Last quarter"],
          ].map(([p, label]) => (
            <Link key={label} href={taxHref(p)} className={`chip !px-2 !py-0.5 text-xs ${report.period === p ? "chip-selected font-bold" : ""}`}>
              {label}
            </Link>
          ))}
        </span>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-3">
        {[
          ["Sales tax collected", money(t.tax), true],
          ["Taxable sales", money(taxable)],
          ["Tax-free sales", money(t.exemptSales)],
        ].map(([label, value, strong]) => (
          <div key={label as string} className="-mb-px -mr-px border-b border-r border-[var(--border)] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
            <div className={`tabular-nums ${strong ? "text-lg font-bold text-[var(--accent)]" : "text-base font-semibold"}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold">Where it came from</h3>
          <TaxTable month={t} />
          <p className="mt-2 text-xs text-[var(--muted)]">
            At {report.ratePercent}%, {money(taxable)} of taxable sales comes to {money(expected)}; {money(t.tax)} was collected.
            {Math.abs(expected - t.tax) >= 0.05 && " The gap is rounding, plus any sales that didn't carry tax (online tickets before Sept. 28 had none added)."}
          </p>
        </section>

        {isQuarter ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-2 text-sm font-semibold">By month</h3>
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1 font-medium">Month</th>
                  <th className="pb-1 text-right font-medium">Sales</th>
                  <th className="pb-1 text-right font-medium">Tax</th>
                </tr>
              </thead>
              <tbody>
                {report.months.map((m) => (
                  <tr key={m.month} className="border-t border-[var(--border)]">
                    <td className="py-1">
                      <Link href={taxHref(m.month)} className="hover:underline">
                        {m.label}
                      </Link>
                    </td>
                    <td className="py-1 text-right">{money(m.sales)}</td>
                    <td className="py-1 text-right font-medium">{money(m.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            <h3 className="mb-2 text-sm font-semibold">Filing quarterly?</h3>
            <p>
              <Link href={taxHref(quarterOf(report.period))} className="text-[var(--accent)] hover:underline">
                See {quarterOf(report.period).replace(/^(\d{4})-Q(\d)$/, "Q$2 $1")} as a whole
              </Link>{" "}
              for the three months together, with each month underneath.
            </p>
          </section>
        )}
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--muted)]">
        <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">What&apos;s counted</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Sales are before tax and after member discounts. Tips aren&apos;t sales and are left out.</li>
          <li>
            Days run 4 a.m. to 4 a.m. Central, like the rest of Reports, so a sale after midnight on the last night of a month counts in that month.
          </li>
          <li>
            Refunds: a fully refunded order, ticket or cancelled booth isn&apos;t counted at all. A partial refund comes off the month the order was sold. So a refund
            made after you&apos;ve filed a month changes that month here; the amount you filed stays what it was.
          </li>
          <li>
            Not included: Insiders+ monthly and yearly memberships. Stripe bills and taxes those itself, so their tax is in Stripe&apos;s tax reports, not here. Add it
            to these figures when you file.
          </li>
          {!report.giftsTracked && <li>Gift memberships aren&apos;t counted yet: their database update hasn&apos;t been applied.</li>}
        </ul>
      </section>
    </>
  );
}

function TaxTable({ month }: { month: TaxMonth }) {
  if (month.lines.length === 0 && month.refunds.sales === 0) return <p className="text-sm text-[var(--muted)]">No sales in this period.</p>;
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-[var(--muted)]">
          <th className="pb-1 font-medium" />
          <th className="pb-1 text-right font-medium">Sales</th>
          <th className="pb-1 text-right font-medium">Tax</th>
        </tr>
      </thead>
      <tbody>
        {month.lines.map((l) => (
          <tr key={l.label} className="border-t border-[var(--border)]">
            <td className="py-1 pr-2">{l.label}</td>
            <td className="py-1 text-right">{money(l.sales)}</td>
            <td className="py-1 text-right">{money(l.tax)}</td>
          </tr>
        ))}
        {(month.refunds.sales > 0 || month.refunds.tax > 0) && (
          <tr className="border-t border-[var(--border)] text-[var(--muted)]">
            <td className="py-1 pr-2">Partial refunds</td>
            <td className="py-1 text-right">−{money(month.refunds.sales)}</td>
            <td className="py-1 text-right">−{money(month.refunds.tax)}</td>
          </tr>
        )}
        <tr className="border-t-2 border-[var(--border)] font-semibold">
          <td className="pt-1 pr-2">Total</td>
          <td className="pt-1 text-right">{money(month.sales)}</td>
          <td className="pt-1 text-right">{money(month.tax)}</td>
        </tr>
      </tbody>
    </table>
  );
}
