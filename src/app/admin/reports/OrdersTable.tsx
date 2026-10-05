"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DayOrder } from "@/lib/data/reports";
import ManagerPinModal from "@/components/ManagerPinModal";
import { approvalText } from "@/lib/pin-rules";
import { refundOrder, refundOrderPart } from "./actions";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// One line per order, newest first. Refunds need a manager PIN and return
// card money through Stripe: all of an order, or part of it (a wrong drink,
// a dish sent back).
export default function OrdersTable({ orders, emptyText = "No orders this day." }: { orders: DayOrder[]; emptyText?: string }) {
  const router = useRouter();
  const [choosing, setChoosing] = useState<DayOrder | null>(null);
  const [full, setFull] = useState<DayOrder | null>(null);
  const [part, setPart] = useState<{ order: DayOrder; amount: number; reason: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (orders.length === 0) return <p className="text-sm text-[var(--muted)]">{emptyText}</p>;

  const refundButton = (o: DayOrder, big = false) =>
    o.status === "completed" ? (
      <button
        className={`rounded-full border border-[var(--border)] hover:border-[var(--foreground)] ${big ? "px-3 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs"}`}
        onClick={() => {
          setDone(null);
          // An owner-tab order comes off the tab whole: no part refunds.
          if (o.ownerTab) setFull(o);
          else setChoosing(o);
        }}
      >
        {o.ownerTab ? "Take off tab" : "Refund"}
      </button>
    ) : (
      <span className="text-xs capitalize">{o.ownerTab && o.status === "refunded" ? "taken off tab" : o.status}</span>
    );

  return (
    <div>
      {done && <div className="notice notice-success mb-3 !p-3 text-sm">{done}</div>}

      {/* Phones: one card per order. */}
      <ul className="divide-y divide-[var(--border)] sm:hidden">
        {orders.map((o) => {
          const off = o.status !== "completed";
          return (
            <li key={o.id} className={`py-3 ${off ? "text-[var(--muted)]" : ""}`}>
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">#{o.orderNumber}</span>
                <span className="text-xs text-[var(--muted)]">
                  {time(o.at)}
                  {o.cashier ? ` · ${o.cashier}` : ""}
                  {o.method ? ` · ${o.method}` : ""}
                </span>
                <span className={`ml-auto font-semibold tabular-nums ${off ? "line-through" : ""}`}>{money(o.total)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm">
                {o.name && <span className="font-medium">{o.name}: </span>}
                {o.items}
              </p>
              <div className="mt-1.5 flex items-center gap-3 text-xs">
                {o.tip > 0 && <span className="text-[var(--muted)]">Tip {money(o.tip)}</span>}
                {o.refunded > 0 && !off && <span className="text-[var(--danger-text)]">−{money(o.refunded)} refunded</span>}
                <span className="ml-auto">{refundButton(o, true)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="pb-1.5 pr-2 font-medium">#</th>
              <th className="pb-1.5 pr-2 font-medium">Time</th>
              <th className="pb-1.5 pr-2 font-medium">Cashier</th>
              <th className="pb-1.5 pr-2 font-medium">Items</th>
              <th className="pb-1.5 pr-2 font-medium">Paid</th>
              <th className="pb-1.5 pr-2 text-right font-medium">Tip</th>
              <th className="pb-1.5 pr-2 text-right font-medium">Total</th>
              <th className="pb-1.5" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const off = o.status !== "completed";
              return (
                <tr key={o.id} className={`border-t border-[var(--border)] ${off ? "text-[var(--muted)]" : ""}`}>
                  <td className="py-1.5 pr-2">{o.orderNumber}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2">{time(o.at)}</td>
                  <td className="py-1.5 pr-2">{o.cashier ?? "—"}</td>
                  <td className="max-w-[18rem] truncate py-1.5 pr-2 xl:max-w-[32rem] 2xl:max-w-[44rem]" title={o.items}>
                    {o.name && <span className="font-medium">{o.name}: </span>}
                    {o.items}
                  </td>
                  <td className="py-1.5 pr-2 capitalize">{o.method ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{o.tip > 0 ? money(o.tip) : ""}</td>
                  <td className={`py-1.5 pr-2 text-right font-medium ${off ? "line-through" : ""}`}>
                    {money(o.total)}
                    {o.refunded > 0 && !off && <div className="text-xs font-normal text-[var(--danger-text)]">−{money(o.refunded)} refunded</div>}
                  </td>
                  <td className="py-1.5 text-right">{refundButton(o)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {choosing && (
        <RefundChooser
          order={choosing}
          onCancel={() => setChoosing(null)}
          onFull={() => {
            setFull(choosing);
            setChoosing(null);
          }}
          onPart={(amount, reason) => {
            setPart({ order: choosing, amount, reason });
            setChoosing(null);
          }}
        />
      )}

      {full && full.ownerTab && (
        // Off an owner's tab: another owner's PIN, and why. No money moves.
        <ManagerPinModal
          title="Another owner's PIN"
          description={`Take order #${full.orderNumber} (${money(full.total)}) off ${full.ownerTab}'s owner tab? An owner other than ${full.ownerTab} approves it, and the statement shows who and why.`}
          reasonLabel="Why it's coming off the tab"
          onCancel={() => setFull(null)}
          onSubmit={async (pin, reason) => {
            const r = await refundOrder(full.id, pin, reason);
            if (!r.ok) throw new Error(r.error); // shown in the PIN box
            setDone(`Order #${full.orderNumber} is off ${full.ownerTab}'s owner tab. ${approvalText(r)}`);
            setFull(null);
            router.refresh();
          }}
        />
      )}

      {full && !full.ownerTab && (
        <ManagerPinModal
          description={`Manager approval is required to refund all of order #${full.orderNumber} (${money(full.total)}${full.refunded > 0 ? `, less the ${money(full.refunded)} already refunded` : ""}).`}
          onCancel={() => setFull(null)}
          onSubmit={async (pin) => {
            const r = await refundOrder(full.id, pin);
            if (!r.ok) throw new Error(r.error); // shown in the PIN box
            setDone(`Order #${full.orderNumber} refunded. ${approvalText(r)}`);
            setFull(null);
            router.refresh();
          }}
        />
      )}

      {part && (
        <ManagerPinModal
          description={`Manager approval is required to give back ${money(part.amount)} of order #${part.order.orderNumber}${part.order.paidByCard ? " (card money goes back to their card)" : ""}.`}
          onCancel={() => setPart(null)}
          onSubmit={async (pin) => {
            const r = await refundOrderPart(part.order.id, part.amount, part.reason, pin);
            if (!r.ok) throw new Error(r.error); // shown in the PIN box
            setDone(`${r.message} ${approvalText(r)}`);
            setPart(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// All of it, or part: how much, and why (kept with the refund).
function RefundChooser({ order, onCancel, onFull, onPart }: { order: DayOrder; onCancel: () => void; onFull: () => void; onPart: (amount: number, reason: string) => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const value = Math.round(parseFloat(amount) * 100) / 100;
  const tooMuch = value > order.refundable;
  const canPart = value > 0 && !tooMuch;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm shadow-2xl">
        <h3 className="text-lg font-semibold">Refund order #{order.orderNumber}</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {money(order.total)} paid{order.tip > 0 ? `, ${money(order.tip)} of it tip` : ""}
          {order.refunded > 0 ? `. ${money(order.refunded)} already refunded.` : "."}
        </p>

        <button className="btn-secondary mt-4 w-full" onClick={onFull}>
          Refund all of it{order.refunded > 0 ? " (the rest)" : ""}
        </button>

        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="text-sm font-medium">Or give back part of it</div>
          {order.refundable > 0 ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm">$</span>
                <input
                  className="input w-28 !py-1"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && canPart && onPart(value, reason)}
                />
                <span className="text-xs text-[var(--muted)]">up to {money(order.refundable)}</span>
              </div>
              <input className="input mt-2 !py-1 text-sm" placeholder="Why (optional), e.g. wrong drink" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
              {tooMuch && <p className="mt-1 text-xs text-[var(--danger-text)]">That&apos;s more than can go back in part. Use &ldquo;Refund all of it&rdquo; instead.</p>}
              <p className="mt-2 text-xs text-[var(--muted)]">
                Enter what the customer gets back, tax included. Card money goes back to the card; cash comes from the drawer. Tips and vouchers only come back with a full
                refund.
              </p>
              <button className="btn-primary mt-3 w-full" disabled={!canPart} onClick={() => onPart(value, reason)}>
                Give back {canPart ? money(value) : "part"}
              </button>
            </>
          ) : (
            <p className="mt-1 text-xs text-[var(--muted)]">Nothing left to give back in part (tips and vouchers only come back with a full refund).</p>
          )}
        </div>

        <button className="mt-3 w-full text-sm text-[var(--muted)] hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
