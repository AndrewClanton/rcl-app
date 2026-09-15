"use client";

import { useState } from "react";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function TipModal({ subtotal, tabName, onConfirm, onCancel }: { subtotal: number; tabName: string; onConfirm: (tip: number) => void; onCancel: () => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">Add a tip?</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Closing tab: <strong className="text-neutral-900 dark:text-neutral-100">{tabName}</strong>
        </p>

        {!customOpen ? (
          <>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[15, 18, 20].map((pct) => (
                <button key={pct} className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700" onClick={() => onConfirm(subtotal * (pct / 100))}>
                  {pct}%
                </button>
              ))}
              <button className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700" onClick={() => onConfirm(0)}>
                No tip
              </button>
            </div>
            <button className="mt-3 text-sm text-neutral-500 hover:underline" onClick={() => setCustomOpen(true)}>
              Custom amount
            </button>
          </>
        ) : (
          <div className="mt-4 space-y-2 text-left">
            <label className="mb-1 block text-xs text-neutral-500">Custom tip amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button
              className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
              onClick={() => onConfirm(parseFloat(custom) || 0)}
            >
              Use this amount
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
