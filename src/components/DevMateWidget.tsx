"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { submitDevNote } from "@/app/admin/dev-notes/actions";

// Admin-only feedback tool, mounted once in the root layout (src/app/layout.tsx)
// so it's available on every page. The root layout itself stays a plain
// static Server Component (no cookie/session read) so public pages keep
// their static generation -- this component checks admin status itself, via
// a tiny API route, rather than the layout gating it server-side. Captures
// the page the admin was on automatically, so a note never loses its context.
export default function DevMateWidget() {
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev-mate/session")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAuthorized(!!data.isAdmin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      setSent(false);
      setOpen(false);
    }, 1400);
    return () => clearTimeout(t);
  }, [sent]);

  function submit() {
    const trimmed = message.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await submitDevNote({ pagePath: pathname, pageTitle: document.title, message: trimmed });
      setMessage("");
      setSent(true);
    });
  }

  if (!authorized) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 font-sans">
      {open ? (
        <div className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Develop Mate</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--foreground)]">
              ✕
            </button>
          </div>
          {sent ? (
            <p className="py-4 text-center text-sm text-[var(--muted)]">Sent -- thanks.</p>
          ) : (
            <>
              <p className="mb-1.5 truncate rounded border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 font-mono text-[11px] text-[var(--muted)]" title={pathname}>
                {pathname}
              </p>
              <textarea
                autoFocus
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Bug, typo, or a change you want on this page..."
                className="input mb-2 resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                }}
              />
              <button onClick={submit} disabled={pending || !message.trim()} className="btn-primary w-full !py-1.5 text-sm">
                {pending ? "Sending…" : "Send note"}
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium shadow-lg hover:border-[var(--accent)]"
        >
          Dev note
        </button>
      )}
    </div>
  );
}
