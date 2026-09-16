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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-xs text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h3>
        <input
          autoFocus
          className="input mt-4"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && onSubmit(value.trim())}
        />
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
