"use client";

import { useEffect, useId, useRef } from "react";

// A panel that slides in from the right for working on one thing without
// leaving the page: the whole screen on a phone, a column on an iPad or
// computer. The same look as Reports' drill-down. Escape, the ✕ or a tap
// on the dimmed page closes it; the page behind doesn't scroll while it's
// open.
export default function SideSheet({
  title,
  subtitle,
  top,
  onClose,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  top?: React.ReactNode; // above the title (a status tag, a chip)
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 print:hidden" onClick={() => close.current()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-[var(--background)] shadow-2xl outline-none sm:max-w-xl sm:border-l sm:border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="min-w-0 flex-1">
            {top && <div className="mb-2 flex flex-wrap items-center gap-2 pt-1.5">{top}</div>}
            <h2 id={titleId} className="text-lg leading-tight font-bold text-balance">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => close.current()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-lg hover:border-[var(--foreground)]"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">{children}</div>
      </div>
    </div>
  );
}
