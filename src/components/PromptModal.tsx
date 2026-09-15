"use client";

import { useState } from "react";

// A native window.prompt() replacement. prompt() is unreliable in embedded/
// kiosk webviews (and unsupported outright in some automated browser
// contexts) -- exactly where this POS is meant to run, so every text
// prompt in the app goes through this instead.
export default function PromptModal({
  title,
  placeholder,
  confirmLabel = "Confirm",
  onSubmit,
  onCancel,
}: {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">{title}</h3>
        <input
          autoFocus
          className="mt-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && onSubmit(value.trim())}
        />
        <div className="mt-4 flex justify-center gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            disabled={!value.trim()}
            onClick={() => onSubmit(value.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
