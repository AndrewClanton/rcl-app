"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import MemberAvatar from "@/components/MemberAvatar";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { FLAG_NOTE_MAX, FLAG_REASONS, FLAG_REASON_KEYS, flagTime, type FlagReason } from "@/lib/member-flags";
import { flagMember, getMemberGlance, type GlanceFlag, type MemberGlanceInfo } from "./checkin-actions";
import { NOT_ACTIVE_RED } from "./LegacyPlusCard";
import type { PosMember } from "./member-actions";
import { memberSignal, memberStanding } from "./member-signal";

// Hold a customer card (Checked in today on the Customers tab, or the
// order's Member box) for about half a second: their account at a glance
// (Andrew, 10/2). For looking only: anything to change is done in Back
// office ("Open in Back office"), so there's nothing here to edit or undo.
// The one thing staff can do is "Flag suspicious activity" (a quiet red
// link at the bottom): a reason and a short note, recorded for an admin or
// owner to look at on the member's Back office page. It blocks nothing.
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

// employeeId: the cashier on the register, who the flag says flagged it.
// onFlagged: it's flagged now (Checked in today shows its 🚩).
export default function MemberGlance({
  member: m,
  employeeId,
  onClose,
  onFlagged,
}: {
  member: PosMember;
  employeeId: string;
  onClose: () => void;
  onFlagged?: (memberId: string) => void;
}) {
  // undefined while it's looked up, null if it couldn't be.
  const [info, setInfo] = useState<MemberGlanceInfo | null | undefined>(undefined);
  // Flagged in this panel just now.
  const [flagged, setFlagged] = useState<GlanceFlag | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Esc backs out of the flag step first.
  const escape = useEffectEvent(() => (flagging ? setFlagging(false) : onClose()));

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
      if (e.key === "Escape") escape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function saveFlag() {
    if (saving || !reason) return;
    setSaving(true);
    setFlagError(null);
    const r = await flagMember(m.id, { reason, note: flagNote }, employeeId || null).catch(() => null);
    setSaving(false);
    if (!r) return setFlagError("Couldn't reach the server. Try again.");
    if (!r.ok) return setFlagError(r.error);
    setFlagged(r.flag);
    setFlagging(false);
    onFlagged?.(m.id);
  }

  const flag = flagged ?? info?.flag ?? null;
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
        {flag ? (
          <p className="mt-3 text-center text-sm font-semibold" style={{ color: "var(--danger-text)" }} role="status">
            🚩 Flagged{flag.by ? ` by ${flag.by}` : ""} · {flagTime(flag.at)}
          </p>
        ) : flagging ? (
          <form
            className="mt-3 space-y-2 border-t pt-3"
            style={{ borderColor: "var(--border)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void saveFlag();
            }}
          >
            <div className="text-sm font-bold" style={{ color: "var(--danger-text)" }}>
              Flag suspicious activity
            </div>
            <div className="grid gap-1" role="radiogroup" aria-label="Reason">
              {FLAG_REASON_KEYS.map((k) => (
                <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm" style={{ borderColor: reason === k ? "var(--foreground)" : "var(--border)" }}>
                  <input type="radio" name="flag-reason" className="h-5 w-5" checked={reason === k} onChange={() => setReason(k)} />
                  {FLAG_REASONS[k]}
                </label>
              ))}
            </div>
            <input
              className="input min-h-11 !py-1.5 text-sm"
              placeholder="Short note (optional)"
              aria-label="Short note (optional)"
              maxLength={FLAG_NOTE_MAX}
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
            />
            {flagError && (
              <div className="text-xs" style={{ color: "var(--danger-text)" }}>
                {flagError}
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary min-h-11 flex-1 !py-1.5 text-sm" disabled={saving || !reason}>
                {saving ? "Flagging…" : "Flag account"}
              </button>
              <button type="button" className="btn-secondary min-h-11 !px-4 !py-1.5 text-sm" disabled={saving} onClick={() => setFlagging(false)}>
                Cancel
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              An admin or owner looks at it in Back office. It doesn&apos;t block anything here.
            </p>
          </form>
        ) : (
          info !== undefined && (
            <button type="button" className="mx-auto mt-3 block min-h-11 px-2 text-sm underline-offset-2 hover:underline" style={{ color: "var(--danger-text)" }} onClick={() => setFlagging(true)}>
              Flag suspicious activity
            </button>
          )
        )}
      </div>
    </div>
  );
}
