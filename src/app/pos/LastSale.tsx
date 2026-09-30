"use client";

import { useState } from "react";
import { receiptXml, type ReceiptData } from "@/lib/print/receipt";
import type { PrintResult } from "@/lib/print/epos-client";
import { printTickets, type TicketSale } from "./print-tickets";
import { sendPrint, type PrintTarget } from "./printing";

// The last sale's receipt and movie tickets, one tap away on the order panel
// ("Can I get a receipt?"). They used to be in Devices. Also where a print
// that failed after a sale says so, with a way to try again. Older sales
// reprint from Recent. PosApp keys this by order number, so each sale starts
// fresh.
export default function LastSale({
  receipt,
  tickets,
  target,
  autoPrint,
  note,
  onNote,
}: {
  receipt: ReceiptData;
  tickets: TicketSale[] | null;
  target: PrintTarget;
  autoPrint: boolean; // this register prints a receipt after every sale
  note: string | null; // what went wrong printing after the sale
  onNote: (note: string | null) => void;
}) {
  const [busy, setBusy] = useState<"receipt" | "tickets" | null>(null);
  const [printed, setPrinted] = useState(false);
  const [sent, setSent] = useState<"receipt" | "tickets" | null>(null);

  // A receipt that already came out on its own prints again marked REPRINT.
  const again = printed || (autoPrint && !note);

  async function run(what: "receipt" | "tickets", job: () => Promise<PrintResult>) {
    setBusy(what);
    setSent(null);
    const r = await job().catch((): PrintResult => ({ ok: false, error: "Couldn't reach the printer." }));
    setBusy(null);
    onNote(r.ok ? null : r.error);
    if (!r.ok) return;
    if (what === "receipt") setPrinted(true);
    setSent(what);
    setTimeout(() => setSent((s) => (s === what ? null : s)), 3000);
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-xs ${note ? "notice-warn" : ""}`}
      style={note ? undefined : { borderColor: "var(--border)", color: "var(--muted)" }}
      role={note ? "alert" : undefined}
    >
      <span className="min-w-0 flex-1">{note ?? (sent ? "Sent to the printer." : `Last sale: order #${receipt.orderNumber}`)}</span>
      <div className="flex gap-2">
        <button
          className="chip min-h-11 !px-3 !text-sm"
          disabled={!!busy}
          onClick={() => run("receipt", () => sendPrint(target, "receipt", receiptXml({ ...receipt, reprint: again }), `Receipt #${receipt.orderNumber}${again ? " (reprint)" : ""}`))}
        >
          {busy === "receipt" ? "Printing…" : again ? "Reprint receipt" : "Print receipt"}
        </button>
        {tickets && tickets.length > 0 && (
          <button className="chip min-h-11 !px-3 !text-sm" disabled={!!busy} onClick={() => run("tickets", () => printTickets(target, receipt.orderNumber, tickets))}>
            {busy === "tickets" ? "Printing…" : `Reprint ticket${tickets.reduce((n, t) => n + t.qty, 0) === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
