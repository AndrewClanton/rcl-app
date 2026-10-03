"use client";

import { useState } from "react";

// A native window.prompt() replacement. prompt() is unreliable in embedded/
// kiosk webviews (and unsupported outright in some automated browser
// contexts) -- exactly where this POS is meant to run, so every text
// prompt in the app goes through this instead.
// initialValue: filled in already, so one tap on the confirm button takes
// it. The field isn't focused then, so an iPad's keyboard doesn't pop up
// over the buttons; tap it to change the text.
// note: a line under the field (a heads-up, not an error).
export default function PromptModal({
  title,
  placeholder,
  confirmLabel = "Confirm",
  initialValue = "",
  note,
  onSubmit,
  onCancel,
}: {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  initialValue?: string;
  note?: string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-xs text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h3>
        <input
          autoFocus={!initialValue}
          className="input mt-4"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && onSubmit(value.trim())}
        />
        {note && (
          <p className="mt-2 text-xs" style={{ color: "var(--warn-text)" }}>
            {note}
          </p>
        )}
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
