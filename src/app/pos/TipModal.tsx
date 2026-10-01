"use client";

import { useState } from "react";

// The most a tip can be: the whole tab again (a 100% tip), or $100 on a
// small tab. Anything past that is a typo ($500 for $5.00), not a tip.
function maxTip(subtotal: number) {
  return Math.max(100, Math.round(subtotal * 100) / 100);
}

// A tip goes on the card as-is, so it's whole cents, never below zero
// (18% of $23.47 is $4.2246; a typed "-5" would have been a hidden
// discount) and never past maxTip.
function tipAmount(n: number, max: number) {
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, max) : 0;
}

export default function TipModal({ subtotal, tabName, onConfirm: confirm, onCancel }: { subtotal: number; tabName: string; onConfirm: (tip: number) => void; onCancel: () => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const max = maxTip(subtotal);
  const onConfirm = (tip: number) => confirm(tipAmount(tip, max));
  const typed = parseFloat(custom);
  const customProblem = custom === "" ? null : !(typed >= 0) ? "Enter the tip in dollars, like 5 or 4.50." : typed > max ? `A tip over $${max.toFixed(2)} is almost surely a typo. Check the amount.` : null;

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
            <input type="number" step="0.01" min="0" max={max} className="input" value={custom} onChange={(e) => setCustom(e.target.value)} />
            {customProblem && (
              <p className="text-xs" style={{ color: "var(--danger-text)" }}>
                {customProblem}
              </p>
            )}
            <button className="btn-primary w-full" disabled={!!customProblem} onClick={() => onConfirm(typed || 0)}>
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
