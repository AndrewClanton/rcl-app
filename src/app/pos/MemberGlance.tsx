"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import MemberAvatar from "@/components/MemberAvatar";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { getMemberGlance, type MemberGlanceInfo } from "./checkin-actions";
import { NOT_ACTIVE_RED } from "./LegacyPlusCard";
import type { PosMember } from "./member-actions";
import { memberSignal, memberStanding } from "./member-signal";

// Hold a customer card (Checked in today on the Customers tab, or the
// order's Member box) for about half a second: their account at a glance
// (Andrew, 10/2). For looking only: anything to change is done in Back
// office ("Open in Back office"), so there's nothing here to edit or undo.
// Closes with ✕, Esc, or a tap outside.

const HOLD_MS = 500;
// A finger that moves this far is scrolling, not holding.
const SLOP_PX = 10;

// The card's pointer handlers. Touch (the iPad) and a mouse both work: a
// press held HOLD_MS opens the panel, and the tap that ends it doesn't
// count as a tap (so it never fires "Add to order"). Pair with
// HOLD_STYLE so iOS doesn't pop up its text-selection callout.
export function useLongPress() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }

  return (onHold: () => void) => ({
    onPointerDown(e: React.PointerEvent) {
      if (e.button !== 0) return;
      clear();
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onHold();
      }, HOLD_MS);
    },
    onPointerMove(e: React.PointerEvent) {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // A held finger brings up the browser's own menu otherwise.
    onContextMenu(e: React.MouseEvent) {
      if (timer.current || fired.current) e.preventDefault();
    },
    // The click that ends a hold isn't a tap.
    onClickCapture(e: React.MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });
}

// No text selection or iOS callout on a held card.
export const HOLD_CLASS = "select-none [-webkit-touch-callout:none]";

function standingNote(m: PosMember): { text: string; tone: "red" | "gold" | null } {
  const s = memberStanding(m);
  if (s === "unlimited") return { text: "No payment on file for unlimited", tone: "red" };
  if (s === "nocard") return { text: "Insiders+ · no card on file", tone: "red" };
  if (s === "plus") return { text: m.comped ? "Insiders+ · Active (complimentary)" : "Insiders+ · Active", tone: "gold" };
  return { text: "Insiders · points, no discount", tone: null };
}

const TZ = "America/Chicago";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: TZ });
// A business date ("2026-09-28"), read at noon UTC so it's that day here.
function day(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

export default function MemberGlance({ member: m, onClose }: { member: PosMember; onClose: () => void }) {
  // undefined while it's looked up, null if it couldn't be.
  const [info, setInfo] = useState<MemberGlanceInfo | null | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    let live = true;
    getMemberGlance(m.id)
      .then((r) => {
        if (live) setInfo(r);
      })
      .catch(() => {
        if (live) setInfo(null);
      });
    return () => {
      live = false;
    };
  }, [m.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const note = standingNote(m);
  const phone = maskPhone(m.phone);
  const email = maskEmail(m.email);
  const rows: [string, React.ReactNode][] = [
    ["Points", Math.round(m.points).toLocaleString("en-US")],
    ["Checked in today", info === undefined ? "…" : info?.todayAt ? time(info.todayAt) : info ? "Not yet today" : "—"],
    ["Visits", info === undefined ? "…" : info ? info.visits.toLocaleString("en-US") : "—"],
    ["Last visit before today", info === undefined ? "…" : info?.lastVisit ? day(info.lastVisit) : info ? "None" : "—"],
    ["Member since", info === undefined ? "…" : info?.since ? monthYear(info.since) : "—"],
    ["Phone", phone ?? "None on file"],
    ["Email", email ?? "None on file"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="glance-name"
        className="card relative max-h-full w-full max-w-sm overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          className="absolute right-1 top-1 inline-flex min-h-11 min-w-11 items-center justify-center text-xl leading-none"
          style={{ color: "var(--muted)" }}
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
        <div className="flex items-center gap-3 pr-10">
          <MemberAvatar name={m.name} url={m.avatar_url} size={72} plus={memberSignal(m) === "plus"} />
          <div className="min-w-0 flex-1">
            <h2 id="glance-name" className="text-xl font-black leading-tight" style={{ color: "var(--foreground)" }}>
              {m.name}
            </h2>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              {m.tier}
              {m.phoneOnly ? " · phone only" : ""}
            </div>
          </div>
        </div>
        <div
          className={`mt-3 rounded-md px-2.5 py-1.5 text-sm font-bold ${note.tone === "red" ? "text-white" : ""}`}
          style={
            note.tone === "red"
              ? { background: NOT_ACTIVE_RED }
              : note.tone === "gold"
                ? { background: "var(--gold)", color: "var(--gold-foreground)" }
                : { border: "1px solid var(--border)" }
          }
        >
          {note.text}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt style={{ color: "var(--muted)" }}>{label}</dt>
              <dd className="min-w-0 truncate text-right font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {/* A new tab, so the register (and its open sale) stays put. */}
        <a
          href={`/admin/members/${m.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary mt-4 flex min-h-11 w-full items-center justify-center !py-2 text-sm font-bold"
        >
          Open in Back office ↗
        </a>
      </div>
    </div>
  );
}
