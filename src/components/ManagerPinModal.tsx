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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoFocus
          className="mt-4 w-full rounded border border-neutral-300 px-3 py-2 text-center text-lg tracking-[0.5em] dark:border-neutral-700 dark:bg-neutral-950"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && pin.length === 4 && submit()}
        />
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
        <div className="mt-4 flex justify-center gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            disabled={submitting || pin.length !== 4}
            onClick={submit}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
