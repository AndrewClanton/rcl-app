"use client";

import { useEffect } from "react";

// A training opened from the register's shift bar: the training page in a
// full-screen window over the register, so the order on screen stays put.
// The page inside signs off for the on-shift person and tells this window
// to close (postMessage) when they're done or tap Close.
export default function TrainingWindow({ slug, employeeId, name, onClose }: { slug: string; employeeId: string; name: string; onClose: (signed: boolean) => void }) {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const type = (e.data as { type?: string } | null)?.type;
      if (type === "rcl-training-signed") onClose(true);
      if (type === "rcl-training-close") onClose(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label={`Training for ${name}`}>
      <div className="flex items-center justify-between gap-3 rounded-t-lg px-4 py-2" style={{ background: "var(--foreground)", color: "var(--background)" }}>
        <span className="font-bold">Training · {name}</span>
        <button className="min-h-10 rounded-md border-2 px-4 text-sm font-bold" style={{ borderColor: "currentColor" }} onClick={() => onClose(false)}>
          Close
        </button>
      </div>
      <iframe
        title={`Training for ${name}`}
        src={`/training/${encodeURIComponent(slug)}?register=1&for=${encodeURIComponent(employeeId)}`}
        className="w-full flex-1 rounded-b-lg border-0"
        style={{ background: "var(--background)" }}
      />
    </div>
  );
}
