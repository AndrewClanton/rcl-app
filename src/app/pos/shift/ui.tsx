"use client";

import { useEffect } from "react";

// Small pieces the register's shift tools share.

// A red circle with a number, like an app icon's: how many things need a look.
export function CountBadge({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none tabular-nums text-white ${className}`}
      style={{ background: "var(--accent)", boxShadow: "0 0 0 2px var(--surface)" }}
      aria-hidden
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Dialog({ title, onClose, closeLabel = "Close", children }: { title: string; onClose: () => void; closeLabel?: string; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-label={title}>
      <div className="card w-full max-w-lg shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-xl">{title}</h2>
          <button className="-my-2 min-h-11 px-1 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
