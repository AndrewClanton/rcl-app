"use client";

import { useEffect, useState } from "react";
import { FLOURISHES, type FlourishKey } from "@/lib/print/flourishes";
import InfoTip from "@/components/help/InfoTip";
import { RICKROLL_SHOW_MS } from "@/app/display/customer/Rickroll";

// Register → ✨: just for fun. Throw streamers and sparkles across the
// customer screen to get people's attention, or pick a little picture or a
// joke line to print at the bottom of the next receipt, no explanation. The
// receipt surprise turns itself off once it prints.
export default function EasterEggs({
  next,
  onPick,
  onCelebrate,
  onRickroll,
  canPrint,
}: {
  next: FlourishKey | null;
  onPick: (key: FlourishKey | null) => void;
  onCelebrate: () => void;
  onRickroll: (stop: boolean) => void;
  canPrint: boolean; // a printer that auto-prints receipts
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  // While the customer screen is playing it, the same button stops it.
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(false), 2500);
    return () => clearTimeout(timer);
  }, [sent]);

  useEffect(() => {
    if (!rolling) return;
    const timer = setTimeout(() => setRolling(false), RICKROLL_SHOW_MS);
    return () => clearTimeout(timer);
  }, [rolling]);

  const picked = FLOURISHES.find((f) => f.key === next);

  return (
    <div className="relative">
      <button
        className={`btn-secondary whitespace-nowrap py-2 text-sm ${next ? "!border-[var(--gold)]" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Just for fun"
        title="Just for fun"
      >
        ✨{picked ? ` ${picked.icon}` : ""}
      </button>
      {open && (
        <div className="card absolute bottom-full left-0 z-40 mb-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 !p-3 text-sm shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="font-display text-base">
              Just for fun
              <InfoTip topic="easter-eggs" />
            </span>
            <button className="text-xs hover:underline" style={{ color: "var(--muted)" }} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <button
            className="btn-primary w-full !py-2.5"
            onClick={() => {
              onCelebrate();
              setSent(true);
            }}
          >
            {sent ? "🎉 Sent to the customer screen!" : "🎉 Celebrate on the customer screen"}
          </button>
          <button
            className="btn-secondary w-full !py-2.5"
            onClick={() => {
              onRickroll(rolling);
              setRolling(!rolling);
            }}
            aria-pressed={rolling}
          >
            {rolling ? "⏹ Stop the Rickroll" : "🕺 Rickroll the customer screen"}
          </button>
          <div>
            <div className="eyebrow mb-1.5">Next receipt surprise</div>
            <div className="grid grid-cols-2 gap-1.5">
              {FLOURISHES.map((f) => (
                <button
                  key={f.key}
                  className={`chip justify-start !px-2 py-2 text-xs ${next === f.key ? "chip-selected font-bold" : ""}`}
                  onClick={() => onPick(next === f.key ? null : f.key)}
                  aria-pressed={next === f.key}
                >
                  {f.icon} {f.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
              {!canPrint
                ? "Receipts aren't auto-printing on this register, so there's nowhere to put it."
                : next
                  ? `${picked?.label} goes at the bottom of the next receipt, then turns off.`
                  : "Pick one to print at the bottom of the next receipt. No explanation."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
