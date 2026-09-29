"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DayOrder } from "@/lib/data/reports";
import ManagerPinModal from "@/components/ManagerPinModal";
import { approvalText } from "@/lib/pin-rules";
import { refundOrder } from "./actions";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// One line per order, newest first. Refunds need a manager PIN and return
// card money through Stripe.
export default function OrdersTable({ orders }: { orders: DayOrder[] }) {
  const router = useRouter();
  const [refunding, setRefunding] = useState<DayOrder | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (orders.length === 0) return <p className="text-sm text-[var(--muted)]">No orders this day.</p>;

  return (
    <div className="overflow-x-auto">
      {done && <div className="notice notice-success mb-3 !p-3 text-sm">{done}</div>}
      <table className="w-full min-w-[640px] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-[var(--muted)]">
            <th className="pb-1 pr-2 font-medium">#</th>
            <th className="pb-1 pr-2 font-medium">Time</th>
            <th className="pb-1 pr-2 font-medium">Cashier</th>
            <th className="pb-1 pr-2 font-medium">Items</th>
            <th className="pb-1 pr-2 font-medium">Paid</th>
            <th className="pb-1 pr-2 text-right font-medium">Tip</th>
            <th className="pb-1 pr-2 text-right font-medium">Total</th>
            <th className="pb-1" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const off = o.status !== "completed";
            return (
              <tr key={o.id} className={`border-t border-[var(--border)] ${off ? "text-[var(--muted)]" : ""}`}>
                <td className="py-1 pr-2">{o.orderNumber}</td>
                <td className="whitespace-nowrap py-1 pr-2">{time(o.at)}</td>
                <td className="py-1 pr-2">{o.cashier ?? "—"}</td>
                <td className="max-w-[18rem] truncate py-1 pr-2" title={o.items}>
                  {o.name && <span className="font-medium">{o.name}: </span>}
                  {o.items}
                </td>
                <td className="py-1 pr-2 capitalize">{o.method ?? "—"}</td>
                <td className="py-1 pr-2 text-right">{o.tip > 0 ? money(o.tip) : ""}</td>
                <td className={`py-1 pr-2 text-right font-medium ${off ? "line-through" : ""}`}>{money(o.total)}</td>
                <td className="py-1 text-right">
                  {o.status === "completed" ? (
                    <button className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:border-[var(--accent)]" onClick={() => setRefunding(o)}>
                      Refund
                    </button>
                  ) : (
                    <span className="text-xs capitalize">{o.status}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {refunding && (
        <ManagerPinModal
          description={`Manager approval is required to refund order #${refunding.orderNumber} (${money(refunding.total)}).`}
          onCancel={() => setRefunding(null)}
          onSubmit={async (pin) => {
            const r = await refundOrder(refunding.id, pin);
            if (!r.ok) throw new Error(r.error); // shown in the PIN box
            setDone(`Order #${refunding.orderNumber} refunded. ${approvalText(r)}`);
            setRefunding(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
