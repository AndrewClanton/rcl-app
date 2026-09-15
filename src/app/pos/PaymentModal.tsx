"use client";

import { useState } from "react";
import type { CheckoutPayment } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function PaymentModal({ total, onConfirm, onCancel }: { total: number; onConfirm: (payment: CheckoutPayment) => void; onCancel: () => void }) {
  const [splitOpen, setSplitOpen] = useState(false);
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [error, setError] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">Take payment</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Total due: <strong className="text-neutral-900 dark:text-neutral-100">{money(total)}</strong>
        </p>

        {!splitOpen ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
              onClick={() => onConfirm({ method: "cash", cash: total, card: 0 })}
            >
              Cash
            </button>
            <button
              className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
              onClick={() => onConfirm({ method: "card", cash: 0, card: total })}
            >
              Card
            </button>
            <button className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700" onClick={() => setSplitOpen(true)}>
              Split
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2 text-left">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Cash amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Card amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={card}
                onChange={(e) => setCard(e.target.value)}
              />
            </div>
            {error && <div className="text-xs text-red-600">Cash + card must equal the total due.</div>}
            <button
              className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
              onClick={() => {
                const c = parseFloat(cash) || 0;
                const cd = parseFloat(card) || 0;
                if (Math.abs(c + cd - total) > 0.01) {
                  setError(true);
                  return;
                }
                onConfirm({ method: "split", cash: c, card: cd });
              }}
            >
              Confirm split
            </button>
          </div>
        )}

        <button className="mt-4 text-sm text-neutral-500 hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
