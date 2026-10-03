"use client";

import { useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";
import { TAX_EXEMPT_NOTE_MAX, TAX_EXEMPT_REASONS, type TaxExemptReason } from "@/lib/tax-exempt";

// Ticking "Tax exempt" on the register: why, then a manager's PIN. The
// reason, note, cashier and approver are saved on the order, so Reports can
// say why it went without tax (lib/tax-exempt.ts).
export default function TaxExemptModal({ onSubmit, onCancel }: { onSubmit: (reason: TaxExemptReason, note: string, pin: string) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState<TaxExemptReason | null>(null);
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ready = !!reason && (reason !== "other" || !!note.trim()) && pin.length >= 4 && !submitting;

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason, note, pin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm shadow-2xl">
        <h3 className="text-center text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Tax-free order
          <InfoTip topic="manager-pin" />
        </h3>
        <p className="mt-1 text-center text-sm" style={{ color: "var(--muted)" }}>
          Everything is taxed at {SALES_TAX_PERCENT}% unless a manager approves. Why is this one tax-free?
        </p>
        <fieldset className="mt-3 space-y-1.5">
          <legend className="sr-only">Reason</legend>
          {(Object.keys(TAX_EXEMPT_REASONS) as TaxExemptReason[]).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm" style={{ color: "var(--foreground)" }}>
              <input
                type="radio"
                name="tax-exempt-reason"
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setNote("");
                }}
              />
              {TAX_EXEMPT_REASONS[r]}
            </label>
          ))}
        </fieldset>
        {reason && reason !== "courtesy" && (
          <input
            className="input mt-3"
            maxLength={reason === "certificate" ? 40 : TAX_EXEMPT_NOTE_MAX}
            placeholder={reason === "certificate" ? "Certificate # (optional)" : "Short note (required)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
        <label className="mt-3 block text-center text-xs" style={{ color: "var(--muted)" }}>
          Manager PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            className="input mt-1 text-center text-lg tracking-[0.5em]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && ready && submit()}
          />
        </label>
        {error && (
          <div className="mt-2 text-center text-xs" style={{ color: "var(--danger-text)" }}>
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!ready} onClick={submit}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
