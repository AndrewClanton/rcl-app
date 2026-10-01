"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { submitDevNote } from "@/app/admin/dev-notes/actions";

// A page a note can be about, when a screen offers a choice (the register
// offers itself or the customer screen beside it).
export interface NoteAbout {
  label: string;
  path: string;
  title: string;
}

// The pencil the Dev note buttons wear.
export function NoteIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

// "Leave a dev note": a bug, a typo or a change someone wants, saved with
// the page it's about for Back office → Dev notes. Opened from wherever the
// screen keeps its button (the back office menu, the register's shift bar,
// the staff bar on other pages), never from something floating over the
// page. Admins only: the buttons show for admins, and submitDevNote checks
// again on the server.
export default function DevNoteDialog({ onClose, about }: { onClose: () => void; about?: NoteAbout[] }) {
  const pathname = usePathname();
  const [pick, setPick] = useState(0);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choice = about?.[pick] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
  }, [sent, onClose]);

  function submit() {
    const trimmed = message.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await submitDevNote({ pagePath: choice?.path ?? pathname, pageTitle: choice?.title ?? document.title, message: trimmed });
        setMessage("");
        setSent(true);
      } catch {
        setError("Couldn't send the note. Check the connection and try again.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 font-sans sm:p-10 print:hidden" role="dialog" aria-modal="true" aria-labelledby="dev-note-title">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="dev-note-title" className="flex items-center gap-2 text-base font-bold">
            <NoteIcon />
            Leave a dev note
          </h2>
          <button type="button" onClick={onClose} className="-mr-2 inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-[var(--muted)] hover:bg-[var(--surface-hover)]">
            Close
          </button>
        </div>
        {sent ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">Sent. Thanks!</p>
        ) : (
          <>
            {about && about.length > 1 ? (
              <div className="mb-2">
                <div className="mb-1 text-xs text-[var(--muted)]">It&apos;s about</div>
                <div className="flex gap-2">
                  {about.map((a, i) => (
                    <button
                      key={a.path}
                      type="button"
                      onClick={() => setPick(i)}
                      aria-pressed={i === pick}
                      className={`chip min-h-11 flex-1 !text-sm ${i === pick ? "chip-selected font-bold" : ""}`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mb-2 truncate rounded border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 font-mono text-[11px] text-[var(--muted)]" title={choice?.path ?? pathname}>
                About {choice?.path ?? pathname}
              </p>
            )}
            <textarea
              autoFocus
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="A bug, a typo, or a change you want here..."
              aria-label="Your note"
              className="input mb-2 resize-none !text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            {error && (
              <p className="mb-2 text-sm" style={{ color: "var(--danger-text)" }}>
                {error}
              </p>
            )}
            <button type="button" onClick={submit} disabled={pending || !message.trim()} className="btn-primary min-h-11 w-full">
              {pending ? "Sending…" : "Send note"}
            </button>
            <p className="mt-2 text-xs text-[var(--muted)]">Notes go to Back office → Dev notes for the owners to review.</p>
          </>
        )}
      </div>
    </div>
  );
}
