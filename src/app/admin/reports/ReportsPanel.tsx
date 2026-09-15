"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportOrder } from "@/lib/data/reports";
import ManagerPinModal from "@/components/ManagerPinModal";
import { refundOrder } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function ReportsPanel({ todaysOrders, recentOrders }: { todaysOrders: ReportOrder[]; recentOrders: ReportOrder[] }) {
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
