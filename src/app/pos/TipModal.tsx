"use client";

import { useState } from "react";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function TipModal({ subtotal, tabName, onConfirm, onCancel }: { subtotal: number; tabName: string; onConfirm: (tip: number) => void; onCancel: () => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-xs text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Add a tip?
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Closing tab: <strong style={{ color: "var(--foreground)" }}>{tabName}</strong>
        </p>

        {!customOpen ? (
          <>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[15, 18, 20].map((pct) => (
                <button key={pct} className="btn-secondary px-4 py-2" onClick={() => onConfirm(subtotal * (pct / 100))}>
                  {pct}%
                </button>
              ))}
              <button className="btn-secondary px-4 py-2" onClick={() => onConfirm(0)}>
                No tip
              </button>
            </div>
            <button className="mt-3 text-sm hover:underline" style={{ color: "var(--accent)" }} onClick={() => setCustomOpen(true)}>
              Custom amount
            </button>
          </>
        ) : (
          <div className="mt-4 space-y-2 text-left">
            <label className="label-xs">Custom tip amount</label>
            <input type="number" step="0.01" min="0" className="input" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button className="btn-primary w-full" onClick={() => onConfirm(parseFloat(custom) || 0)}>
              Use this amount
            </button>
          </div>
        )}

        <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
