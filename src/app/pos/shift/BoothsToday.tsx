"use client";

import { useState } from "react";
import type { BoothHold, ShiftStatus } from "@/lib/ops/shared";
import { usePrintTarget } from "../printing";
import { printReservedCard } from "../print-reserved";
import { useOpsApi } from "./api";

// Booths held today (each one a to-do until its Reserved card is printed and
// set out) and tomorrow's bookings, with the ones booked in the last day
// marked NEW -- so a booking made online never goes unnoticed. The register
// shows it behind its Booths button (StaffButton.tsx), in a window: `bare`
// leaves off the box it used to sit in above the register.
export default function BoothsToday({ booths, onChanged, bare = false }: { booths: ShiftStatus["booths"]; onChanged: () => void; bare?: boolean }) {
  const api = useOpsApi();
  const target = usePrintTarget();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { today, tomorrow } = booths;
  if (today.length === 0 && tomorrow.length === 0) return null;
  const waiting = today.filter((h) => !h.cardPrintedAt).length;

  async function print(h: BoothHold) {
    setBusy(h.id);
    setMessage(null);
    if (target) {
      const r = await printReservedCard(target, h).catch(() => ({ ok: false as const, error: "Couldn't reach the printer." }));
      if (!r.ok) {
        setBusy(null);
        return setMessage({ ok: false, text: `The card didn't print: ${r.error}` });
      }
    }
    await api.markBoothCardPrinted(h.id).catch(() => null);
    setBusy(null);
    setMessage({ ok: true, text: target ? `Reserved card printed for ${h.booth}. Set it on the booth.` : `${h.booth} marked as set out.` });
    onChanged();
  }

  return (
    <div
      className={bare ? "" : "mb-3 rounded-lg border-2 px-4 py-2.5"}
      style={bare ? undefined : { borderColor: "var(--foreground)", background: waiting > 0 ? "var(--gold)" : "var(--surface)", color: waiting > 0 ? "var(--gold-foreground)" : undefined }}
      role="status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {bare ? (
          waiting > 0 && (
            <span className="rounded px-2 py-1 text-sm font-bold" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
              Print the Reserved card and set it on the booth.
            </span>
          )
        ) : (
          <span className="text-sm font-black uppercase tracking-wide">
            Booths today{today.length > 0 ? ` · ${today.length}` : ""}
            {waiting > 0 && <span className="ml-2 font-bold normal-case tracking-normal">Print the Reserved card and set it on the booth.</span>}
          </span>
        )}
        {!target && today.length > 0 && <span className="text-xs">No printer set up on this register (Devices). You can still mark cards as set out.</span>}
      </div>

      {today.length === 0 ? (
        <div className="mt-1 text-sm opacity-80">No booths held today.</div>
      ) : (
        <ul className="mt-1.5">
          {today.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t py-2 first:border-t-0" style={{ borderColor: "rgba(20,17,12,0.2)" }}>
              {/* When, where and who on their own lines of text, never squeezed
                  to a word a line: with too little room beside them (the
                  pop-up on an iPad), the button drops under them instead. */}
              <span className="flex min-w-0 flex-[1_1_15rem] flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="whitespace-nowrap font-black tabular-nums">{h.window}</span>
                <span className="whitespace-nowrap font-bold">{h.booth}</span>
                <span className="min-w-0 break-words text-sm">
                  {h.name} · <span className="whitespace-nowrap">party of {h.party}</span>
                </span>
              </span>
              {h.cardPrintedAt ? (
                <span className="flex items-center gap-3 text-sm">
                  <span className="font-bold">✓ Card out</span>
                  <button className="min-h-11 px-2 font-bold underline disabled:opacity-50" disabled={busy === h.id || !target} onClick={() => print(h)}>
                    Reprint
                  </button>
                </span>
              ) : (
                <button className="btn-primary min-h-11 !px-4 !py-2 text-sm" disabled={busy === h.id} onClick={() => print(h)}>
                  {busy === h.id ? "Printing…" : target ? "Print Reserved card" : "Mark card set out"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tomorrow.length > 0 && (
        <div className="mt-1.5 border-t pt-2 text-sm" style={{ borderColor: "rgba(20,17,12,0.2)" }}>
          <span className="font-bold">Tomorrow: </span>
          {tomorrow.map((h, i) => (
            <span key={h.id}>
              {i > 0 && " · "}
              {h.booth} {h.window} ({h.name.split(" ")[0]}, {h.party})
              {h.isNew && <span className="ml-1 rounded px-1 text-[11px] font-black text-white" style={{ background: "var(--accent)" }}>NEW</span>}
            </span>
          ))}
        </div>
      )}

      {message && (
        <div className="mt-1.5 text-sm font-bold" style={{ color: message.ok ? undefined : "var(--danger-text)" }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
