"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import DevNoteDialog, { NoteIcon } from "@/components/dev-notes/DevNoteDialog";

// Where "Leave a dev note" lives on each screen. It used to be one button
// floating in the bottom-right corner of every page, on top of whatever was
// there (on the register, the menu buttons). Now:
//   - Back office (/admin): in the menu (AdminShell).
//   - Register (/pos): on the shift bar (ShiftBar), with a choice of the
//     register or the customer screen beside it.
//   - Display screens (/display/...): none. They're signage or face the
//     customer, and often have nobody at them.
//   - Everywhere else (the public site, Help, Training, member profiles): a
//     slim staff bar across the top of the page, in the page's flow, so it
//     never covers anything. Customers never see it.
//
// Mounted once in the root layout (src/app/layout.tsx). The root layout
// stays a plain static Server Component (no cookie/session read) so public
// pages keep their static generation -- this checks admin status itself,
// via a tiny API route.
function hasOwnHome(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/pos" || pathname.startsWith("/pos/") || pathname.startsWith("/display/");
}

export default function DevNotesWidget() {
  const pathname = usePathname();
  const elsewhere = hasOwnHome(pathname);
  const [authorized, setAuthorized] = useState(false);
  const [open, setOpen] = useState(false);

  // Re-checks on every client-side navigation (pathname change), not just
  // once on first mount -- the root layout persists across navigations
  // (that's the point of a layout), so a mount-once check would only ever
  // reflect whatever the auth state was on the very first page load: land
  // on a page before signing in and it stayed hidden for the rest of the
  // visit. A retry also covers a plain transient fetch failure.
  useEffect(() => {
    // Pages with their own button don't need to ask. Nor does a page shown
    // inside another one (the register's training window), which would get
    // a second bar.
    if (elsewhere || window.self !== window.top) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function check() {
      fetch("/api/dev-notes/session")
        .then((res) => {
          if (!res.ok) throw new Error(`status ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (!cancelled) setAuthorized(!!data.isAdmin);
        })
        .catch(() => {
          if (!cancelled) retryTimer = setTimeout(check, 3000);
        });
    }
    check();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [pathname, elsewhere]);

  if (!authorized || elsewhere) return null;
  return (
    <>
      <StaffBar onNote={() => setOpen(true)} />
      {open && <DevNoteDialog onClose={() => setOpen(false)} />}
    </>
  );
}

// order-first: the root layout's <body> is a flex column, so this sits
// above the page even though it's mounted after it.
export function StaffBar({ onNote }: { onNote: () => void }) {
  return (
    <div className="order-first w-full border-b border-[var(--border)] bg-[var(--surface)] font-sans text-sm print:hidden">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-2 sm:px-4">
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-[var(--muted)]">
          <strong className="font-bold uppercase tracking-wide">Staff</strong>
          <span className="hidden sm:inline"> · customers never see this bar</span>
        </span>
        <button type="button" onClick={onNote} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 font-semibold hover:bg-[var(--surface-hover)]">
          <NoteIcon size={16} />
          Leave a dev note
        </button>
        <Link href="/admin" className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-semibold text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
          Back office
        </Link>
      </div>
    </div>
  );
}
