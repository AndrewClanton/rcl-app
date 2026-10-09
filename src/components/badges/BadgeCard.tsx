"use client";

import { useState } from "react";

// A badge copy's card (lib/badges/card.ts draws both sides as SVG on the
// server): the front, and a tap turns it over to the back. The SVG is
// ours, drawn from the catalog with every word escaped, never text from a
// member.
export function BadgeCardFlip({ front, back, label, flipped: start = false }: { front: string; back: string; label: string; flipped?: boolean }) {
  const [flipped, setFlipped] = useState(start);
  return (
    <button type="button" className="badge-flip" aria-pressed={flipped} aria-label={`${label}: ${flipped ? "showing the back, tap for the front" : "tap to turn it over"}`} onClick={() => setFlipped((f) => !f)}>
      <span className="badge-flip-inner">
        <span className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: front }} />
        <span className="badge-face badge-face-back badge-svg" dangerouslySetInnerHTML={{ __html: back }} />
      </span>
    </button>
  );
}
