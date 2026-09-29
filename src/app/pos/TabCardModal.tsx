"use client";

import { useEffect, useRef, useState } from "react";
import { cancelTabCard, checkTabCard, startTabCard } from "./tab-card-actions";

// "Put a card on file?" for a bar tab: the customer taps their card on the
// reader and it's saved, not charged. The tab is charged at close.
export default function TabCardModal({ tabId, tabName, readerId, onSaved, onClose }: { tabId: string; tabName: string; readerId: string | null; onSaved: (label: string) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<"ask" | "waiting" | "saved" | "failed">("ask");
  const [message, setMessage] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const setupRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stop() {
    setupRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  useEffect(() => stop, []);

  async function begin() {
    if (!readerId) {
      setPhase("failed");
      setMessage("No card reader is chosen for this register. Pick one under Devices.");
      return;
    }
    setPhase("waiting");
    setMessage(null);
    const r = await startTabCard(tabId, readerId).catch(() => ({ ok: false as const, error: "Couldn't reach the card reader." }));
    if (!r.ok) {
      setPhase("failed");
      setMessage(r.error);
      return;
    }
    const setupIntentId = r.setupIntentId;
    setupRef.current = setupIntentId;
    // One check at a time, 1.5s after the last answered.
    const check = async () => {
      timerRef.current = null;
      const s = await checkTabCard(setupIntentId, tabId).catch(() => null);
      if (setupRef.current !== setupIntentId) return;
      if (s?.status === "saved") {
        stop();
        setLabel(s.label ?? "Card");
        setPhase("saved");
        onSaved(s.label ?? "Card");
        return;
      }
      if (s?.status === "failed") {
        stop();
        setPhase("failed");
        setMessage(s.message ?? "The card wasn't saved.");
        return;
      }
      if (s?.message) setMessage(s.message);
      timerRef.current = setTimeout(check, 1500);
    };
    timerRef.current = setTimeout(check, 1500);
  }

  async function cancel() {
    const id = setupRef.current;
    stop();
    if (id && readerId) await cancelTabCard(id, readerId).catch(() => {});
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Card on file for {tabName}&apos;s tab
        </h3>
        {phase === "ask" && (
          <>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              They tap their card on the reader and we keep it for the tab. Nothing is charged now; the tab is charged when it&apos;s closed.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button className="btn-secondary" onClick={onClose}>
                Not now
              </button>
              <button className="btn-primary" onClick={begin}>
                Tap card on reader
              </button>
            </div>
          </>
        )}
        {phase === "waiting" && (
          <>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Waiting for them to tap or insert their card on the reader...
            </p>
            {message && (
              <p className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                {message}
              </p>
            )}
            <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={cancel}>
              Cancel
            </button>
          </>
        )}
        {phase === "saved" && (
          <>
            <p className="font-display mt-3 text-2xl" style={{ color: "var(--accent)" }}>
              {label} is on file
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Nothing was charged. Close the tab with &quot;Card on file&quot; to charge it.
            </p>
            <button className="btn-primary mt-4" onClick={onClose}>
              Done
            </button>
          </>
        )}
        {phase === "failed" && (
          <>
            <p className="mt-3 text-sm" style={{ color: "var(--danger-text)" }}>
              {message}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn-secondary" onClick={onClose}>
                Skip
              </button>
              <button className="btn-primary" onClick={begin}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
