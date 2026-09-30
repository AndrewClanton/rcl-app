import Link from "next/link";
import type { PeriodReport } from "@/lib/data/period-report";
import type { TipWeek } from "@/lib/data/day-drill";
import { datesIn, rangeLabel, shortDate, weekday } from "@/lib/report-periods";
import { BarList, Card, Columns, Delta, Rows, SplitBar, Stat, TopItems, money, num } from "./ui";

// Reports -> Week and Month: the same screen for either. Every figure has
// its change from the period before (to the same point, while this one is
// still going).

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(h: number, long = false) {
  const suffix = h < 12 ? (long ? " AM" : "a") : long ? " PM" : "p";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

function dayHref(date: string) {
  return `/admin/reports?date=${date}`;
}

export default function PeriodView({ report, noun, boxOfficeHref, tips }: { report: PeriodReport; noun: "week" | "month"; boxOfficeHref: string; tips?: TipWeek }) {
  const s = report.sales;
  const b = report.previous.sales;
  const m = report.members;
  const bm = report.previous.members;
  const isMonth = noun === "month";
  const avg = s.orderCount ? s.orderSales / s.orderCount : 0;
  const avgBefore = b.orderCount ? b.orderSales / b.orderCount : null;
  const prevName = `last ${noun}`;
  const vs = (n: number, format: (n: number) => string = money) => `vs ${format(n)} ${prevName}`;

  // The whole period on the chart; days still to come are empty.
  const dayValues = new Map(report.days.map((d) => [d.date, d]));
  const allDays = datesIn(report.period.start, report.period.end);
  const best = report.days.reduce<(typeof report.days)[number] | null>((top, d) => (d.netSales > (top?.netSales ?? 0) ? d : top), null);
  const busiest = report.hours.reduce<(typeof report.hours)[number] | null>((top, h) => (h.orders > (top?.orders ?? 0) ? h : top), null);

  // Month: an average day for each day of the week (days so far).
  const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const ds = report.days.filter((d) => weekday(d.date) === dow);
    const total = ds.reduce((sum, d) => sum + d.netSales, 0);
    return { label: WEEKDAYS[dow], value: ds.length ? total / ds.length : 0, detail: ds.length ? `avg of ${ds.length}` : undefined };
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="Net sales" value={money(s.netSales)} now={s.netSales} before={b.netSales} beforeText={vs(b.netSales)} sub="after discounts and refunds, before tax and tips" />
        <Stat label="Orders" value={num(s.orderCount)} now={s.orderCount} before={b.orderCount} beforeText={vs(b.orderCount, num)} />
        <Stat label="Average order" value={s.orderCount ? money(avg) : "—"} now={avg} before={avgBefore} beforeText={avgBefore !== null ? vs(avgBefore) : undefined} />
        <Stat label="Collected" value={money(s.collected)} now={s.collected} before={b.collected} sub="with tax and tips" />
        <Stat label="Tips" value={money(s.tips)} now={s.tips} before={b.tips} />
        <Stat label="Sales tax" value={money(s.tax)} now={s.tax} before={b.tax} />
        <Stat label="Tickets sold" value={num(s.ticketsSold)} now={s.ticketsSold} before={b.ticketsSold} sub={s.tickets.free ? `${num(s.tickets.free)} free` : undefined} />
      </div>
      <p className="text-center text-xs text-[var(--muted)]">
        Compared with {rangeLabel(report.previous.period.start, report.previous.through)}
        {report.previous.partial ? `, up to the same point ${prevName}` : ""}.
      </p>

      <Card
        title="Net sales by day"
        subtitle={best ? `Best day: ${shortDate(best.date, { weekday: true })}, ${money(best.netSales)} from ${num(best.orders)} order${best.orders === 1 ? "" : "s"}. Tap a day to open it.` : undefined}
      >
        <Columns
          height={isMonth ? 120 : 140}
          labelEvery={isMonth ? 7 : 1}
          columns={allDays.map((date) => {
            const d = dayValues.get(date);
            return {
              key: date,
              label: isMonth ? String(Number(date.slice(8))) : `${shortDate(date, { weekday: true }).split(",")[0]}`,
              value: d?.netSales ?? 0,
              title: d ? `${shortDate(date, { weekday: true })}: ${money(d.netSales)} net sales, ${num(d.orders)} orders, ${num(d.tickets)} tickets` : `${shortDate(date, { weekday: true })}: still to come`,
              href: d ? dayHref(date) : undefined,
            };
          })}
          emptyText={`No sales yet this ${noun}.`}
        />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Sales by category" subtitle="Before tax and tips.">
          {s.sold.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing sold.</p>
          ) : (
            <>
              <BarList rows={s.sold.map((r) => ({ label: r.label, value: r.amount, detail: r.detail }))} />
              <div className="mt-4">
                <Rows
                  rows={[
                    ...(s.discounts > 0 ? [{ label: "Member discounts", value: `−${money(s.discounts)}`, muted: true }] : []),
                    ...(s.partialRefunds > 0 ? [{ label: "Given back in partial refunds", value: `−${money(s.partialRefunds)}`, muted: true }] : []),
                    { label: "Net sales", value: money(s.netSales), strong: true },
                  ]}
                />
              </div>
            </>
          )}
        </Card>

        <Card title="Money in" subtitle="How it was paid, with tax and tips.">
          <SplitBar
            parts={[
              { label: "Card", value: s.card },
              { label: "Cash", value: s.cash },
              { label: "Online", value: s.online },
              { label: "Vouchers", value: s.vouchers },
            ]}
          />
          <div className="mt-4">
            <Rows
              rows={[
                { label: "Collected", value: money(s.collected), strong: true },
                { label: "Tips", value: money(s.tips) },
                { label: "Sales tax", value: money(s.tax) },
                ...(s.vouchers > 0 ? [{ label: "Vouchers used (no money in)", value: money(s.vouchers), muted: true }] : []),
              ]}
            />
          </div>
        </Card>

        {tips && <TipsCard tips={tips} noun={noun} />}

        <Card title="Top items">{s.topItems.length === 0 ? <p className="text-sm text-[var(--muted)]">Nothing sold.</p> : <TopItems items={s.topItems} />}</Card>

        <Card
          title="Busiest hours"
          subtitle={busiest ? `Orders by the hour they were rung up. Busiest: ${hourLabel(busiest.hour, true)}, ${num(busiest.orders)} order${busiest.orders === 1 ? "" : "s"}.` : "Orders by the hour they were rung up."}
        >
          <Columns
            height={110}
            format={(n) => num(n)}
            labelEvery={report.hours.length > 12 ? 2 : 1}
            columns={report.hours.map((h) => ({
              key: String(h.hour),
              label: hourLabel(h.hour),
              value: h.orders,
              title: `${hourLabel(h.hour, true)}: ${num(h.orders)} orders, ${money(h.sales)}`,
            }))}
            emptyText="No orders yet."
          />
        </Card>

        {isMonth && (
          <Card title="By day of the week" subtitle="Net sales on an average day, this month so far.">
            <BarList rows={byWeekday} showShare={false} />
          </Card>
        )}

        <Card
          title="Tickets"
          subtitle="By the day they were sold."
          action={
            <Link href={boxOfficeHref} className="font-medium underline-offset-2 hover:underline">
              Per movie →
            </Link>
          }
        >
          <div className="mb-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{num(s.ticketsSold)}</span>
            <span className="text-sm text-[var(--muted)]">{money(s.tickets.revenue)} before tax</span>
          </div>
          <Rows
            rows={[
              { label: "Paid online", value: num(s.tickets.online) },
              { label: "Paid at the register", value: num(s.tickets.register) },
              { label: "Free (Insiders+, free shows)", value: num(s.tickets.free) },
            ]}
          />
          <p className="mt-2 text-xs text-[var(--muted)]">
            {b.ticketsSold > 0 || s.ticketsSold > 0 ? `${num(b.ticketsSold)} ${prevName}. ` : ""}The Box office tab counts them by showing instead, per movie.
          </p>
        </Card>

        <Card title="Members">
          {m ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-[var(--muted)]">Joined</div>
                <div className="text-3xl font-bold">{num(m.joined)}</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  <Delta now={m.joined} before={bm?.joined ?? null} /> {bm ? `${num(bm.joined)} ${prevName}` : ""}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--muted)]">Check-ins</div>
                <div className="text-3xl font-bold">{num(m.checkIns)}</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  <Delta now={m.checkIns} before={bm?.checkIns ?? null} /> {num(m.visitors)} different member{m.visitors === 1 ? "" : "s"}
                </div>
              </div>
              {m.imported > 0 && <p className="col-span-2 text-xs text-[var(--muted)]">Plus {num(m.imported)} moved over from the old site (not counted as joined).</p>}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Couldn&apos;t read members right now.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

// The tip payouts recorded on the Day report (Tips -> Record tip payout),
// per person, and the days with tips still to record.
function TipsCard({ tips, noun }: { tips: TipWeek; noun: string }) {
  return (
    <Card title={`Tips this ${noun}`} subtitle={`${money(tips.tips)} in tips; ${money(tips.paid)} recorded as paid out.`}>
      {!tips.ready ? (
        <p className="text-sm text-[var(--muted)]">Recording payouts needs a database update first.</p>
      ) : (
        <>
          {tips.people.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No payouts recorded yet.</p>
          ) : (
            <Rows
              rows={tips.people.map((p) => ({
                key: p.employeeId,
                label: (
                  <>
                    {p.name}
                    <span className="ml-1.5 text-xs text-[var(--muted)]">
                      {p.days} day{p.days === 1 ? "" : "s"}
                    </span>
                  </>
                ),
                value: <span className="font-semibold">{money(p.amount)}</span>,
              }))}
            />
          )}
          {tips.unrecorded.length > 0 && (
            <div className="mt-3 text-xs text-[var(--muted)]">
              Not recorded yet:{" "}
              {tips.unrecorded.map((d, i) => (
                <span key={d.date}>
                  {i > 0 && ", "}
                  <Link href={`/admin/reports?date=${d.date}&show=tips`} className="font-medium text-[var(--foreground)] underline-offset-2 hover:underline">
                    {shortDate(d.date, { weekday: true })} ({money(d.tips)})
                  </Link>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
