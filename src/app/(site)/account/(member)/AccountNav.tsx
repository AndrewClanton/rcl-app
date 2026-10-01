"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account", label: "Overview" },
  { href: "/account/points", label: "Points" },
  { href: "/account/purchases", label: "Purchases" },
  { href: "/account/movies", label: "Movies" },
  { href: "/account/billing", label: "Billing" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/email", label: "Emails" },
];

// How far the fade reaches in from an edge with more tabs past it.
const FADE = "2.5rem";

// The account's tabs, one row. On a phone it scrolls sideways: it snaps tab
// by tab, an edge with more tabs past it fades out and gets an arrow, and
// the open tab is brought into view (centered) whenever it changes. From a
// tablet up every tab fits and none of that shows.
export default function AccountNav() {
  const path = usePathname();
  const listRef = useRef<HTMLUListElement>(null);
  const placed = useRef(false);
  // Which edges have tabs past them; null until measured. Until then the
  // right edge fades, so a phone shows it on its first paint (on a wide
  // screen the fade falls on empty space, so it doesn't show), and no
  // arrows, which would show anywhere.
  const [more, setMore] = useState<{ left: boolean; right: boolean } | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft < max - 2;
      setMore((m) => (m && m.left === left && m.right === right ? m : { left, right }));
    };
    el.addEventListener("scroll", measure, { passive: true });
    // Fires once on observe too, which takes the first measurement.
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, []);

  // The open tab, centered in the strip. Scrolls only the strip, never the
  // page; slides when the tab changes, jumps on the first load.
  useEffect(() => {
    const el = listRef.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !tab) return;
    const left = tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2;
    const still = !placed.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, left), behavior: still ? "auto" : "smooth" });
    placed.current = true;
  }, [path]);

  function nudge(dir: 1 | -1) {
    const el = listRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: "smooth" });
  }

  const left = more?.left ?? false;
  const right = more?.right ?? true;
  const mask = `linear-gradient(to right, ${left ? `transparent, #000 ${FADE}` : "#000, #000"}, ${right ? `#000 calc(100% - ${FADE}), transparent` : "#000"})`;

  return (
    <nav aria-label="Account" className="relative -mx-4">
      <ul
        ref={listRef}
        className="relative flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {TABS.map((t) => {
          const active = t.href === "/account" ? path === "/account" : path.startsWith(t.href);
          return (
            <li key={t.href} className="shrink-0 snap-start">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`day-chip inline-flex min-h-11 items-center ${active ? "day-chip-today" : ""}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Arrows for the edges with more past them. Thumbs can just swipe
          and the keyboard scrolls the strip by itself as focus moves, so
          these are for the mouse and are kept out of the tab order. */}
      {more?.left && <Arrow side="left" onClick={() => nudge(-1)} />}
      {more?.right && <Arrow side="right" onClick={() => nudge(1)} />}
    </nav>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onClick}
      className={`absolute inset-y-0 ${side === "left" ? "left-0" : "right-0"} flex w-11 items-center justify-center`}
    >
      <span className="font-display grid size-8 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--surface)] text-base leading-none shadow-[2px_2px_0_var(--foreground)]">
        {side === "left" ? "‹" : "›"}
      </span>
    </button>
  );
}
