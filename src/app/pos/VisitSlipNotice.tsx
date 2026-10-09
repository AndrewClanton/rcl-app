"use client";

import { useState } from "react";
import { visitSlipLines, type VisitSlip } from "@/lib/print/receipt";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

// An organization visit just recorded (Record visit, or Recent orders): the
// slip as it printed, for the group's helper, with Print again. No prices,
// no staff names.
export default function VisitSlipNotice({ slip, onPrint, onClose }: { slip: VisitSlip; onPrint: (() => Promise<unknown> | void) | null; onClose: () => void }) {
  const [printing, setPrinting] = useState(false);
  const t = visitSlipLines(slip);
  return (
    <div className="notice notice-success p-2.5 text-xs" role="status">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">Royale Cinema · Visit record — not a receipt</div>
          <div className="mt-1">
            <span className="font-semibold">{slip.orgName}</span> · {when(slip.at)}
          </div>
          <div>{t.guests}</div>
          <div>{t.comps}</div>
          {slip.movies.length > 0 && <div>Movies: {slip.movies.join(", ")}</div>}
          <div>Order #{slip.orderNumber}</div>
          <div className="mt-1" style={{ color: "var(--muted)" }}>
            {t.footer}
          </div>
        </div>
        <button className="chip !px-2 !py-0.5" onClick={onClose} aria-label="Close the visit slip">
          ×
        </button>
      </div>
      {onPrint && (
        <button
          className="chip mt-2 !px-3 !py-1"
          disabled={printing}
          onClick={async () => {
            setPrinting(true);
            try {
              await onPrint();
            } finally {
              setPrinting(false);
            }
          }}
        >
          {printing ? "Printing…" : "Print again"}
        </button>
      )}
    </div>
  );
}
