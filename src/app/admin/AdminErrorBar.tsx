"use client";

import { useEffect, useState } from "react";
import { ACTION_ERROR_EVENT } from "@/lib/useRefreshingAction";

// The back office's "that didn't save" bar. Any screen that saves through
// useRefreshingAction announces a failure here, so a save that didn't go
// through is never silent. It stays up until closed (a message that fades
// on its own is easy to miss mid-shift), and a repeat of the same message
// just stays put.
export default function AdminErrorBar() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const show = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    window.addEventListener(ACTION_ERROR_EVENT, show);
    return () => window.removeEventListener(ACTION_ERROR_EVENT, show);
  }, []);

  if (!message) return null;

  return (
    <div role="alert" className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
      <div className="flex w-full max-w-2xl items-start gap-3 rounded-lg border border-[var(--danger-text)] bg-[var(--surface)] p-3 text-sm shadow-2xl">
        <span className="font-semibold text-[var(--danger-text)]">Not saved.</span>
        <span className="min-w-0 flex-1">{message}</span>
        <button className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]" onClick={() => setMessage(null)}>
          Close
        </button>
      </div>
    </div>
  );
}
