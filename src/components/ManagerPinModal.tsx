"use client";

import { useState } from "react";

export default function ManagerPinModal({
  title = "Enter manager PIN",
  description = "This action needs manager approval.",
  onSubmit,
  onCancel,
}: {
  title?: string;
  description?: string;
  onSubmit: (pin: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(pin);
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
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {description}
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoFocus
          className="input mt-4 text-center text-lg tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && pin.length === 4 && submit()}
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
          <button className="btn-primary" disabled={submitting || pin.length !== 4} onClick={submit}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
