"use client";

import { useEffect, useRef, useState } from "react";
import type { OldCardOffer } from "@/lib/fortis-claim";
import { claimOldCard, notTheirOldCard } from "./old-card-actions";

// "Old card on file?": after a card sale, the card that paid matches one
// from the old register that nobody has claimed (old-card-actions.ts).
// Small and out of the way: the next sale goes on while it's up, and it
// goes away on its own when its 5 minutes are up.
export default function OldCardPrompt({ offer, onClose }: { offer: OldCardOffer; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const t = setTimeout(() => closeRef.current(), done ? (done.ok ? 8000 : 15000) : offer.ttlMs);
    return () => clearTimeout(t);
  }, [done, offer.ttlMs]);

  async function run(action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setBusy(true);
    const r = await action().catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    setBusy(false);
    setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
  }

  const visits = `${offer.visits} past visit${offer.visits === 1 ? "" : "s"}`;
  const range = offer.since ? ` since ${offer.since}` : "";
  return (
    <div className={`notice ${done && !done.ok ? "notice-warn" : "notice-success"} p-2.5 text-xs`} role="status">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold">
          {done
            ? done.text
            : `Old card on file? ····${offer.lastFour} (${offer.brand}), ${visits}${range}. Claim for ${offer.firstName}?${
                offer.needsApproval ? " It's over 1,000 points, so a manager approves it first." : ""
              }`}
        </span>
        <button className="shrink-0 px-1 text-sm leading-none" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {!done && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="chip !px-3 !py-1" disabled={busy} onClick={() => run(() => claimOldCard(offer.orderId, offer.cardId, offer.token))}>
            Claim
          </button>
          <button className="chip !px-3 !py-1" disabled={busy} onClick={() => run(() => notTheirOldCard(offer.orderId, offer.cardId, offer.token))}>
            Not theirs
          </button>
        </div>
      )}
    </div>
  );
}
