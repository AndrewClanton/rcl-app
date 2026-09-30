import type { AlcoholUsageRow, PourCostRow } from "@/lib/data/reports";
import { Card, Pill, money } from "../ui";

// Reports -> Bar usage, as drawn: the page (./page.tsx) checks the sign-in
// and gets the figures.

export const BAR_RANGES = [7, 30, 90];

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

export default function BarScreen({ days, usage, pour }: { days: number; usage: AlcoholUsageRow[]; pour: PourCostRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Pour cost by drink" subtitle="Ingredient cost ÷ menu price. Bars aim for 16–20%; red is over 20%.">
        {pour.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No drinks on the menu yet.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 font-medium">Drink</th>
                <th className="pb-1.5 text-right font-medium">Price</th>
                <th className="pb-1.5 text-right font-medium">Cost</th>
                <th className="pb-1.5 text-right font-medium">Pour</th>
              </tr>
            </thead>
            <tbody>
              {pour.map((row) => (
                <tr key={row.menuItemId} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-2">{row.name}</td>
                  <td className="py-1.5 text-right">{money(row.price)}</td>
                  <td className="py-1.5 text-right text-[var(--muted)]">{row.ingredientCost === null ? "—" : money(row.ingredientCost)}</td>
                  <td className={`py-1.5 text-right font-medium ${row.pourCostPct !== null && row.pourCostPct > 0.2 ? "text-[var(--danger-text)]" : ""}`}>
                    {row.pourCostPct === null ? <span className="text-xs font-normal text-[var(--muted)]">needs costs</span> : `${(row.pourCostPct * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Pours vs. counts"
        subtitle="What recipes say was poured vs. what the shelf counts say left. Red means more left the shelf than was rung up."
        action={
          <span className="flex gap-1">
            {BAR_RANGES.map((n) => (
              <Pill key={n} href={`/admin/reports/bar${n === 30 ? "" : `?days=${n}`}`} active={n === days}>
                {n}d
              </Pill>
            ))}
          </span>
        }
      >
        {usage.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No ingredients yet. Add them on the Ingredients page.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 font-medium">Ingredient</th>
                <th className="pb-1.5 text-right font-medium">Rung up</th>
                <th className="pb-1.5 text-right font-medium">Counted</th>
                <th className="pb-1.5 text-right font-medium">Over</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((row) => {
                const over = row.variance !== null && row.variance > 0;
                return (
                  <tr key={row.ingredientId} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2">{row.name}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      {row.theoreticalUsage.toFixed(1)} {unitLabel(row.unit)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right text-[var(--muted)]">{row.physicalUsage === null ? "—" : `${row.physicalUsage.toFixed(1)} ${unitLabel(row.unit)}`}</td>
                    <td className={`whitespace-nowrap py-1.5 text-right ${over ? "font-medium text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>
                      {row.variance === null
                        ? "—"
                        : row.varianceCost !== null
                          ? `${row.varianceCost > 0 ? "+" : ""}${money(row.varianceCost)}`
                          : `${row.variance > 0 ? "+" : ""}${row.variance.toFixed(1)} ${unitLabel(row.unit)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">&ldquo;Counted&rdquo; needs two shelf counts around the range (Ingredients page).</p>
      </Card>
    </div>
  );
}
