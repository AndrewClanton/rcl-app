"use client";

import { useCallback, useEffect, useState } from "react";
import { FLOURISHES, type FlourishKey } from "@/lib/print/flourishes";
import type { RickrollState } from "@/lib/registerChannel";
import InfoTip from "@/components/help/InfoTip";

// How long the Rickroll button waits for the customer screen to answer.
const RICKROLL_ANSWER_MS = 4_000;

export interface Rickroll {
  playing: boolean; // what the customer screen last said
  asking: "start" | "stop" | null; // waiting for it to answer
  noAnswer: boolean; // it didn't, the last time
  press: () => void;
  onState: (p: Partial<RickrollState> | null) => void; // its answer ("rickroll-state")
}

// The Rickroll button only says what the customer screen confirms. Pressed,
// it asks the screen to start ("rickroll", { play: true }) or stop
// ("rickroll-stop") and shows "Starting…" or "Stopping…" until a screen
// answers ("rickroll-state", lib/registerChannel.ts; any screen, if there's
// more than one). No answer in 4 seconds: it says so and goes back to what
// it last heard. The screen also says when the clip ends by itself or
// someone taps ✕ there, which turns the button back to "Rickroll".
export function useRickroll(send: (event: "rickroll" | "rickroll-stop", payload: object) => void): Rickroll {
  const [playing, setPlaying] = useState(false);
  const [asking, setAsking] = useState<"start" | "stop" | null>(null);
  const [noAnswer, setNoAnswer] = useState(false);

  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => {
      setAsking(null);
      setNoAnswer(true);
    }, RICKROLL_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [asking]);

  useEffect(() => {
    if (!noAnswer) return;
    const timer = setTimeout(() => setNoAnswer(false), 8_000);
    return () => clearTimeout(timer);
  }, [noAnswer]);

  const press = useCallback(() => {
    if (asking) return;
    const start = !playing;
    send(start ? "rickroll" : "rickroll-stop", start ? { play: true } : {});
    setAsking(start ? "start" : "stop");
    setNoAnswer(false);
  }, [asking, playing, send]);

  const onState = useCallback((p: Partial<RickrollState> | null) => {
    if (typeof p?.playing !== "boolean") return;
    const now = p.playing;
    setPlaying(now);
    setAsking((was) => (was === (now ? "start" : "stop") ? null : was));
    setNoAnswer(false);
  }, []);

  return { playing, asking, noAnswer, press, onState };
}

// Register → ✨: just for fun. Throw streamers and sparkles across the
// customer screen to get people's attention, Rickroll it (useRickroll), or
// pick a little picture or a joke line to print at the bottom of the next
// receipt, no explanation. The receipt surprise turns itself off once it
// prints.
export default function EasterEggs({
  next,
  onPick,
  onCelebrate,
  rickroll,
  canPrint,
}: {
  next: FlourishKey | null;
  onPick: (key: FlourishKey | null) => void;
  onCelebrate: () => void;
  rickroll: Rickroll;
  canPrint: boolean; // a printer that auto-prints receipts
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(false), 2500);
    return () => clearTimeout(timer);
  }, [sent]);

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
          <div>
            <button
              className="btn-secondary w-full !py-2.5"
              onClick={rickroll.press}
              disabled={!!rickroll.asking}
              aria-pressed={rickroll.playing}
              aria-busy={!!rickroll.asking}
            >
              {rickroll.asking === "start"
                ? "Starting…"
                : rickroll.asking === "stop"
                  ? "Stopping…"
                  : rickroll.playing
                    ? "⏹ Stop the Rickroll"
                    : "🕺 Rickroll the customer screen"}
            </button>
            {rickroll.noAnswer && (
              <p className="mt-1 text-xs" role="status" style={{ color: "var(--danger-text)" }}>
                The tablet didn&apos;t answer. Is the customer screen open? Refreshing it can help.
              </p>
            )}
          </div>
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
