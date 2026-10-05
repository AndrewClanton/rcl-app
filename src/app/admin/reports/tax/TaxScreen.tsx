import Link from "next/link";
import { expectedTax, type SalesTaxReport, type TaxMonth } from "@/lib/data/reports";
import { shiftMonth } from "@/lib/report-periods";
import type { PaymentSyncStatus } from "@/lib/membership-payments/read";
import { syncNote } from "../MembershipsCard";
import { Card, PeriodNav, Pill, Stat, money } from "../ui";

// Reports -> Sales tax, as drawn: the page (./page.tsx) picks the period,
// checks the sign-in and gets the figures.

export function quarterOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

function shiftQuarter(period: string, n: number) {
  const [y, q] = period.split("-Q").map(Number);
  const i = y * 4 + (q - 1) + n;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
}

// " This period: 2 Insiders+ charges had no tax ($30.00 of sales)."
function untaxedNote(report: SalesTaxReport) {
  const u = report.untaxedMemberships;
  if (!u.count) return "";
  return ` This period: ${u.count} Insiders+ charge${u.count === 1 ? "" : "s"} had no tax (${money(u.sales)} of sales).`;
}

export default function TaxScreen({ report, thisMonth, sync }: { report: SalesTaxReport; thisMonth: string; sync: PaymentSyncStatus }) {
  const thisQuarter = quarterOf(thisMonth);
  const isQuarter = report.period.includes("Q");
  const prev = isQuarter ? shiftQuarter(report.period, -1) : shiftMonth(report.period, -1);
  const next = isQuarter ? shiftQuarter(report.period, 1) : shiftMonth(report.period, 1);
  const hasNext = isQuarter ? next <= thisQuarter : next <= thisMonth;
  const t = report.total;
  const taxable = t.sales - t.exemptSales;
  const expected = expectedTax(t);
  const taxHref = (period: string) => `/admin/reports/tax${period === thisMonth ? "" : `?period=${period}`}`;

  return (
    <div className="space-y-5">
      <PeriodNav title={report.label} subtitle={isQuarter ? "The quarter's three months together" : "One month"} prev={taxHref(prev)} next={hasNext ? taxHref(next) : null}>
        {[
          [thisMonth, "This month"],
          [shiftMonth(thisMonth, -1), "Last month"],
          [thisQuarter, "This quarter"],
          [shiftQuarter(thisQuarter, -1), "Last quarter"],
        ].map(([p, label]) => (
          <Pill key={label} href={taxHref(p)} active={report.period === p}>
            {label}
          </Pill>
        ))}
      </PeriodNav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="Sales tax collected" value={money(t.tax)} sub={`at ${report.ratePercent}%`} />
        <Stat label="Taxable sales" value={money(taxable)} />
        <Stat label="Tax-free sales" value={money(t.exemptSales)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Where it came from">
          <TaxTable month={t} />
          <p className="mt-3 text-xs text-[var(--muted)]">
            At {report.ratePercent}%, {money(taxable)} of taxable sales comes to {money(expected)}; {money(t.tax)} was collected.
            {Math.abs(expected - t.tax) >= 0.05 &&
              " The gap is rounding, plus any sales that didn't carry tax: online tickets sold before tax was added to them, and Insiders+ subscriptions started before the evening of Sept. 28, which are billed without tax (renewals included) until tax is added to them." +
                untaxedNote(report)}
          </p>
        </Card>

        {isQuarter ? (
          <Card title="By month">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1.5 font-medium">Month</th>
                  <th className="pb-1.5 text-right font-medium">Sales</th>
                  <th className="pb-1.5 text-right font-medium">Tax</th>
                </tr>
              </thead>
              <tbody>
                {report.months.map((m) => (
                  <tr key={m.month} className="border-t border-[var(--border)]">
                    <td className="py-1.5">
                      <Link href={taxHref(m.month)} className="underline-offset-2 hover:underline">
                        {m.label}
                      </Link>
                    </td>
                    <td className="py-1.5 text-right">{money(m.sales)}</td>
                    <td className="py-1.5 text-right font-medium">{money(m.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card title="Filing quarterly?" className="text-sm">
            <p>
              <Link href={taxHref(quarterOf(report.period))} className="font-medium underline underline-offset-2">
                See {quarterOf(report.period).replace(/^(\d{4})-Q(\d)$/, "Q$2 $1")} as a whole
              </Link>{" "}
              for the three months together, with each month underneath.
            </p>
          </Card>
        )}
      </div>

      <Card title="What's counted" className="text-sm">
        <ul className="list-disc space-y-1.5 pl-5 text-[var(--muted)]">
          <li>Sales are before tax and after member discounts. Tips aren&apos;t sales and are left out.</li>
          <li>Days run 4 a.m. to 4 a.m. Central, like the rest of Reports, so a sale after midnight on the last night of a month counts in that month.</li>
          <li>
            Owner tab: what the owners have at the owner rate is counted in the month it was rung, at the owner price, with the tax charged on it, whether or not the
            owner has paid that month&apos;s tab yet. Confirm that treatment with the accountant before filing.
          </li>
          <li>
            Refunds: a fully refunded order, ticket or cancelled booth isn&apos;t counted at all. A partial refund comes off the month the order was sold. So a refund made after
            you&apos;ve filed a month changes that month here; the amount you filed stays what it was.
          </li>
          {report.membershipsTracked ? (
            <li>
              Insiders+ memberships: every card charge Stripe made for one (new members, monthly and yearly renewals, switches from monthly to yearly), on the business
              day it was charged, and gift memberships on the day they were paid. A refund of one comes off the month of the charge. Insiders+ subscriptions started
              before the evening of Sept. 28 are billed without tax, renewals included, until tax is added to them. {syncNote(sync)}
            </li>
          ) : (
            <li>
              Not included yet: Insiders+ monthly and yearly memberships. Their database update (member payments) hasn&apos;t been applied, so until then their tax is only
              in Stripe&apos;s own reports. Add it to these figures when you file.
            </li>
          )}
          {!report.giftsTracked && <li>Gift memberships aren&apos;t counted yet: their database update hasn&apos;t been applied.</li>}
        </ul>
      </Card>
    </div>
  );
}

function TaxTable({ month }: { month: TaxMonth }) {
  if (month.lines.length === 0 && month.refunds.sales === 0) return <p className="text-sm text-[var(--muted)]">No sales in this period.</p>;
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-[var(--muted)]">
          <th className="pb-1.5 font-medium" />
          <th className="pb-1.5 text-right font-medium">Sales</th>
          <th className="pb-1.5 text-right font-medium">Tax</th>
        </tr>
      </thead>
      <tbody>
        {month.lines.map((l) => (
          <tr key={l.label} className="border-t border-[var(--border)]">
            <td className="py-1.5 pr-2">{l.label}</td>
            <td className="py-1.5 text-right">{money(l.sales)}</td>
            <td className="py-1.5 text-right">{money(l.tax)}</td>
          </tr>
        ))}
        {(month.refunds.sales > 0 || month.refunds.tax > 0) && (
          <tr className="border-t border-[var(--border)] text-[var(--muted)]">
            <td className="py-1.5 pr-2">Partial refunds</td>
            <td className="py-1.5 text-right">−{money(month.refunds.sales)}</td>
            <td className="py-1.5 text-right">−{money(month.refunds.tax)}</td>
          </tr>
        )}
        <tr className="border-t-2 border-[var(--foreground)] font-semibold">
          <td className="pt-1.5 pr-2">Total</td>
          <td className="pt-1.5 text-right">{money(month.sales)}</td>
          <td className="pt-1.5 text-right">{money(month.tax)}</td>
        </tr>
      </tbody>
    </table>
  );
}
