"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AlcoholUsageRow, MembershipAnalytics, PourCostRow, ReportOrder, RevenueDay } from "@/lib/data/reports";
import ManagerPinModal from "@/components/ManagerPinModal";
import { refundOrder } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

export default function ReportsPanel({
  todaysOrders,
  recentOrders,
  revenueTrend,
  membership,
  alcoholUsage,
  pourCost,
  days,
}: {
  todaysOrders: ReportOrder[];
  recentOrders: ReportOrder[];
  revenueTrend: RevenueDay[];
  membership: MembershipAnalytics;
  alcoholUsage: AlcoholUsageRow[];
  pourCost: PourCostRow[];
  days: number;
}) {
  const stats = useMemo(() => {
    const revenue = todaysOrders.reduce((s, o) => s + o.total, 0);
    const tips = todaysOrders.reduce((s, o) => s + (o.tip || 0), 0);
    const cash = todaysOrders.reduce((s, o) => s + (o.payment_cash_amount || 0), 0);
    const card = todaysOrders.reduce((s, o) => s + (o.payment_card_amount || 0), 0);
    const avg = todaysOrders.length ? revenue / todaysOrders.length : 0;
    return { orders: todaysOrders.length, revenue, tips, cash, card, avg };
  }, [todaysOrders]);

  const topSellers = useMemo(() => {
    const tally = new Map<string, { qty: number; revenue: number }>();
    for (const o of todaysOrders) {
      for (const line of o.items) {
        const entry = tally.get(line.name) ?? { qty: 0, revenue: 0 };
        entry.qty += line.quantity;
        entry.revenue += line.unit_price * line.quantity;
        tally.set(line.name, entry);
      }
    }
    return [...tally.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 8);
  }, [todaysOrders]);

  const modifierTally = useMemo(() => {
    const tally = new Map<string, number>();
    for (const o of todaysOrders) {
      for (const line of o.items) {
        if (line.is_event) continue;
        for (const m of line.modifiers) tally.set(m, (tally.get(m) ?? 0) + 1);
      }
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [todaysOrders]);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Revenue trend</h2>
          <div className="flex gap-1 text-xs">
            {[7, 30, 90].map((n) => (
              <Link
                key={n}
                href={`/admin/reports?days=${n}`}
                className={`rounded border px-2 py-1 ${
                  n === days
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                }`}
              >
                {n}d
              </Link>
            ))}
          </div>
        </div>
        <RevenueTrendChart data={revenueTrend} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Membership & community impact</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["Total members", String(membership.total)],
            ["Insiders", String(membership.insiders)],
            ["Insiders+ (paying)", String(membership.payingInsidersPlus)],
            ["Free/community members", String(membership.compedMembers)],
            ["New this month", String(membership.newThisMonth)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="text-xs text-neutral-500">{label}</div>
              <div className="mt-1 text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
        {membership.byProgram.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-sm font-medium text-neutral-600 dark:text-neutral-400">Free members by community program</div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {membership.byProgram.map(({ program, count }) => (
                <div key={program} className="flex justify-between py-1.5 text-sm">
                  <span>{program}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Alcohol usage & variance</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Expected usage is recipe quantity × drinks sold in this range. Variance needs two physical counts (Ingredients page) bracketing
          the range to compute -- positive means more was physically used than recipes account for. Set a cost per ingredient on the
          Ingredients page to see $ figures too; sorted by $ impact when known.
        </p>
        {alcoholUsage.length === 0 ? (
          <div className="text-sm text-neutral-500">No ingredients yet -- add some from the Ingredients page.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="py-1.5 pr-3 font-medium">Ingredient</th>
                  <th className="py-1.5 pr-3 font-medium">Expected usage</th>
                  <th className="py-1.5 pr-3 font-medium">Physical count change</th>
                  <th className="py-1.5 pr-3 font-medium">Variance</th>
                  <th className="py-1.5 font-medium">Variance ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {alcoholUsage.map((row) => (
                  <tr key={row.ingredientId}>
                    <td className="py-1.5 pr-3">{row.name}</td>
                    <td className="py-1.5 pr-3">
                      {row.theoreticalUsage.toFixed(2)} {unitLabel(row.unit)}
                    </td>
                    <td className="py-1.5 pr-3 text-neutral-500">
                      {row.physicalUsage === null ? "Not enough counts" : `${row.physicalUsage.toFixed(2)} ${unitLabel(row.unit)}`}
                    </td>
                    <td
                      className={`py-1.5 pr-3 font-medium ${
                        row.variance === null ? "text-neutral-400" : row.variance > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-500"
                      }`}
                    >
                      {row.variance === null
                        ? "—"
                        : `${row.variance > 0 ? "+" : ""}${row.variance.toFixed(2)} ${unitLabel(row.unit)}${row.variance > 0 ? " over" : ""}`}
                    </td>
                    <td
                      className={`py-1.5 font-medium ${
                        row.varianceCost === null ? "text-neutral-400" : row.varianceCost > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-500"
                      }`}
                    >
                      {row.varianceCost === null ? (row.unitCost === null ? "no cost set" : "—") : `${row.varianceCost > 0 ? "+" : ""}${money(row.varianceCost)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Pour cost by drink</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Ingredient cost as a share of menu price for each alcohol item -- the standard bar-industry "pour cost" metric. Bars typically
          target 16-20%; higher means less margin on that drink. Only shown once every ingredient in a recipe has a cost set.
        </p>
        {pourCost.length === 0 ? (
          <div className="text-sm text-neutral-500">No alcohol menu items yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="py-1.5 pr-3 font-medium">Drink</th>
                  <th className="py-1.5 pr-3 font-medium">Price</th>
                  <th className="py-1.5 pr-3 font-medium">Ingredient cost</th>
                  <th className="py-1.5 font-medium">Pour cost %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {pourCost.map((row) => (
                  <tr key={row.menuItemId}>
                    <td className="py-1.5 pr-3">{row.name}</td>
                    <td className="py-1.5 pr-3">{money(row.price)}</td>
                    <td className="py-1.5 pr-3 text-neutral-500">{row.ingredientCost === null ? "—" : money(row.ingredientCost)}</td>
                    <td
                      className={`py-1.5 font-medium ${
                        row.pourCostPct === null ? "text-neutral-400" : row.pourCostPct > 0.2 ? "text-red-600 dark:text-red-400" : "text-neutral-500"
                      }`}
                    >
                      {row.pourCostPct === null ? "missing ingredient cost(s)" : `${(row.pourCostPct * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Today&apos;s summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Orders today", String(stats.orders)],
            ["Revenue", money(stats.revenue)],
            ["Average order", money(stats.avg)],
            ["Cash collected", money(stats.cash)],
            ["Card collected", money(stats.card)],
            ["Tips collected", money(stats.tips)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="text-xs text-neutral-500">{label}</div>
              <div className="mt-1 text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Top sellers today</h2>
        {topSellers.length === 0 ? (
          <div className="text-sm text-neutral-500">No sales recorded yet today.</div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {topSellers.map(([name, v]) => (
              <div key={name} className="flex justify-between py-1.5 text-sm">
                <span>
                  {name} × {v.qty}
                </span>
                <span>{money(v.revenue)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Sales by modifier today</h2>
        {modifierTally.length === 0 ? (
          <div className="text-sm text-neutral-500">No modifier data yet today.</div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {modifierTally.map(([name, count]) => (
              <div key={name} className="flex justify-between py-1.5 text-sm">
                <span>{name}</span>
                <span>{count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent orders</h2>
        {recentOrders.length === 0 ? (
          <div className="text-sm text-neutral-500">No completed orders yet.</div>
        ) : (
          <div className="space-y-2">
            {recentOrders.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderRow({ order }: { order: ReportOrder }) {
  const router = useRouter();
  const [pinOpen, setPinOpen] = useState(false);

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Order #{order.order_number} — {money(order.total)} — {order.employee?.name ?? "no cashier"}
        </span>
        {order.status === "refunded" ? (
          <span className="rounded-full border border-red-500 px-2 py-0.5 text-xs text-red-600">Refunded</span>
        ) : (
          <button className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => setPinOpen(true)}>
            Refund
          </button>
        )}
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {new Date(order.created_at).toLocaleString()} · {order.payment_method ?? "unknown"} · {order.items.length} item(s)
        {order.tab_name ? ` · tab: ${order.tab_name}` : ""}
        {order.tip ? ` · tip ${money(order.tip)}` : ""}
      </div>

      {pinOpen && (
        <ManagerPinModal
          description="Manager approval is required to refund this order."
          onCancel={() => setPinOpen(false)}
          onSubmit={async (pin) => {
            await refundOrder(order.id, pin);
            setPinOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RevenueTrendChart({ data }: { data: RevenueDay[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const totalForRange = data.reduce((s, d) => s + d.total, 0);

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 text-sm text-neutral-500">Total for range: {money(totalForRange)}</div>
      <div className="flex h-32 items-end gap-[2px]">
        {data.map((d) => {
          const posH = (d.pos / max) * 100;
          const webH = (d.web / max) * 100;
          const ticketsH = (d.tickets / max) * 100;
          return (
            <div
              key={d.date}
              className="group relative flex-1"
              title={`${d.date}: ${money(d.total)} (POS ${money(d.pos)}, web ${money(d.web)}, tickets ${money(d.tickets)})`}
            >
              <div className="flex h-32 flex-col-reverse">
                <div className="bg-neutral-400 dark:bg-neutral-600" style={{ height: `${posH}%` }} />
                <div className="bg-amber-400 dark:bg-amber-600" style={{ height: `${webH}%` }} />
                <div className="bg-emerald-400 dark:bg-emerald-600" style={{ height: `${ticketsH}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 bg-neutral-400 dark:bg-neutral-600" /> POS
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 bg-amber-400 dark:bg-amber-600" /> Web
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 bg-emerald-400 dark:bg-emerald-600" /> Tickets
        </span>
        <span>
          {data[0]?.date} – {data[data.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}
