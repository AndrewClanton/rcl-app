"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HELP_TOPICS, type HelpTopic, type HelpTopicKey } from "@/lib/help/topics";
import TopicContent from "./TopicContent";

// The little circled "i" next to a label or heading: tap it for a short,
// plain-English explanation of that thing and why it works the way it does,
// with links to the training and the Help & FAQ page. The words live in
// src/lib/help/topics.ts, so the same entry is the FAQ answer too.
//
//   <h2>Printers <InfoTip topic="printers-how-it-works" /></h2>
//
// A popover next to the button on a wide screen, a sheet from the bottom on
// a phone. It's drawn at the end of <body> (a portal) with fixed
// positioning, so a modal, a scrolling panel or overflow: hidden around the
// button can't clip it, and nothing on the page moves when it opens. Works
// inside server pages and client components alike.

type Mode = "popover" | "sheet";

const WIDE = "(min-width: 640px)";
const GAP = 8; // between the button and the popover
const EDGE = 12; // kept clear of the screen's edges
const MAX_WIDTH = 360;

export default function InfoTip({
  topic,
  tone = "muted",
  className = "",
}: {
  topic: HelpTopicKey;
  // "ink" on a colored band (the gold check-in header), where muted gray is
  // too faint.
  tone?: "muted" | "ink";
  className?: string;
}) {
  const t: HelpTopic = HELP_TOPICS[topic];
  const [mode, setMode] = useState<Mode | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const panelId = `${id}panel`;
  const titleId = `${id}title`;

  const close = useCallback((refocus: boolean) => {
    setMode(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // The popover goes under the button if it fits (else above, whichever
  // side has more room), centered on it and kept on screen. Set straight on
  // the element: it's measuring the page, not state to render from. False
  // when the button has scrolled off screen (nothing left to point at).
  const place = useCallback((): boolean => {
    const b = buttonRef.current;
    const p = panelRef.current;
    if (!b || !p || p.dataset.mode !== "popover") return true;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) return false;
    const width = Math.min(MAX_WIDTH, vw - EDGE * 2);
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, EDGE), vw - width - EDGE);
    const scrolled = p.scrollTop;
    p.style.width = `${width}px`;
    p.style.left = `${left}px`;
    p.style.maxHeight = "none";
    const height = p.offsetHeight;
    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const under = height <= below || below >= above;
    const room = Math.max(140, under ? below : above);
    p.style.maxHeight = `${room}px`;
    p.style.top = `${under ? r.bottom + GAP : Math.max(EDGE, r.top - GAP - Math.min(height, room))}px`;
    p.style.visibility = "visible";
    p.scrollTop = scrolled;
    return true;
  }, []);

  useLayoutEffect(() => {
    if (!mode) return;
    place();
    panelRef.current?.focus({ preventScroll: true });
  }, [mode, place]);

  useEffect(() => {
    if (!mode) return;
    // A tap outside the popover closes it (and still does what it tapped).
    // The sheet has a backdrop instead, which closes it on its own click, so
    // that tap never lands on the register underneath.
    const onPointerDown = (e: PointerEvent) => {
      if (mode === "sheet") return;
      const target = e.target as Node | null;
      if (!target || panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    // The page (or a panel around the button) scrolled, or the screen
    // turned: follow the button. Scrolling the help itself isn't a move.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      if (!place()) close(false);
    };
    // Capture, and stopped here: Esc closes this and nothing else (not the
    // modal or sheet the bubble sits in).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        close(true);
        return;
      }
      // Tab stays inside the open help; Esc gets out.
      if (e.key === "Tab" && panelRef.current) {
        const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [mode, close, place]);

  const panel = mode && (
    // Clicks inside stay inside: a portal passes React events up to the
    // bubble's parents (a clickable row, a modal's backdrop) otherwise.
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {mode === "sheet" && <div className="fixed inset-0 z-[1000] bg-black/40" aria-hidden="true" onClick={() => close(true)} />}
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal={mode === "sheet" ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-mode={mode}
        className={
          mode === "sheet"
            ? "fixed inset-x-0 bottom-0 z-[1001] max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t px-4 pt-2 outline-none"
            : "fixed z-[1001] overflow-y-auto rounded-xl border px-4 pb-4 pt-3 outline-none"
        }
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          color: "var(--foreground)",
          boxShadow: "0 14px 36px rgba(20, 17, 12, 0.22), 0 2px 6px rgba(20, 17, 12, 0.08)",
          ...(mode === "sheet" ? { paddingBottom: "max(20px, env(safe-area-inset-bottom))" } : { visibility: "hidden", top: 0, left: EDGE }),
        }}
      >
        {mode === "sheet" && <div className="mx-auto mb-2 h-1 w-10 rounded-full" style={{ background: "var(--border)" }} aria-hidden="true" />}
        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true">
            <InfoGlyph />
          </span>
          <h2 id={titleId} className="min-w-0 flex-1 text-[15.5px] font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
            {t.title}
          </h2>
          <button
            type="button"
            onClick={() => close(true)}
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none hover:bg-[var(--surface-hover)]"
            style={{ color: "var(--muted)" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <TopicContent topicKey={topic} topic={t} />
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${t.title}`}
        aria-haspopup="dialog"
        aria-expanded={!!mode}
        aria-controls={mode ? panelId : undefined}
        title={`About ${t.title}`}
        onClick={(e) => {
          // Never the click of a label, row or form around it.
          e.preventDefault();
          e.stopPropagation();
          if (mode) close(false);
          else setMode(window.matchMedia(WIDE).matches ? "popover" : "sheet");
        }}
        // A 22px circle with a 44px touch target around it (the ::before),
        // so it's easy to hit on the iPad without taking up more room. The
        // negative margin keeps it from making a line of small text taller.
        className={`relative mx-1 -my-[3px] inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full align-middle text-[var(--tip)] transition-colors before:absolute before:-inset-[11px] before:content-[''] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] print:hidden ${className}`}
        style={{ "--tip": mode ? "var(--accent)" : tone === "ink" ? "var(--foreground)" : "var(--muted)" } as React.CSSProperties}
      >
        <InfoGlyph />
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  );
}

// A circle with a lowercase i.
function InfoGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="9.75" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="6.9" r="1.35" fill="currentColor" />
      <path d="M11 10v6.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
