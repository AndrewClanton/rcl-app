"use client";

import { useState } from "react";
import InfoTip from "@/components/help/InfoTip";

// reasonLabel: also ask why (taking an order off an owner's tab needs a
// reason); it's passed to onSubmit with the PIN, and Confirm waits for it.
export default function ManagerPinModal({
  title = "Enter manager PIN",
  description = "This action needs manager approval.",
  reasonLabel,
  onSubmit,
  onCancel,
}: {
  title?: string;
  description?: string;
  reasonLabel?: string;
  onSubmit: (pin: string, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ready = pin.length >= 4 && (!reasonLabel || reason.trim().length >= 3);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(pin, reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-xs text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
          <InfoTip topic="manager-pin" />
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {description}
        </p>
        {reasonLabel && (
          <input
            className="input mt-4 min-h-11 text-sm"
            placeholder={reasonLabel}
            maxLength={200}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus={!reasonLabel}
          aria-label="PIN"
          className="input mt-4 text-center text-lg tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && ready && !submitting && submit()}
        />
        {error && (
          <div className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={submitting || !ready} onClick={submit}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
