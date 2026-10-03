"use client";

import { useEffect, useRef, useState } from "react";
import { NewEmailButtons } from "../OverviewControls";

// The Email pages' "New email": the same starters as always (the weekly
// lineup and the rest, lib/email/templates.ts), in a window over the page.
// Ink, not red: it starts a draft, it doesn't email anyone. On a phone it's
// a square + button with its name for screen readers.
export default function NewEmail() {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const shut = () => {
    setOpen(false);
    opener.current?.focus();
  };
  return (
    <>
      <button ref={opener} type="button" className="btn-ink !h-12 !w-12 !px-0 sm:!w-auto sm:!px-[22px] sm:text-base" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="sr-only sm:not-sr-only">New email</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && shut()}>
          <div role="dialog" aria-modal="true" aria-labelledby="new-email-title" className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="new-email-title" className="font-display text-2xl">
                  New email
                </h2>
                <p className="text-sm text-[var(--muted)]">Pick a starting point. It opens as a draft: nothing goes to anyone until someone who sends presses Send.</p>
              </div>
              <button ref={close} type="button" className="btn-secondary min-h-11 !px-4 !py-2 text-sm" onClick={shut}>
                Close
              </button>
            </div>
            <NewEmailButtons />
          </div>
        </div>
      )}
    </>
  );
}
