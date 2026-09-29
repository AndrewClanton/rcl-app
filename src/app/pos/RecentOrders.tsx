"use client";

import { useState } from "react";
import { receiptXml, type ReceiptData } from "@/lib/print/receipt";
import { printerBaseUrl, type PrintResult } from "@/lib/print/epos-client";
import ManagerPinModal from "@/components/ManagerPinModal";
import { approvalText } from "@/lib/pin-rules";
import { getRecentRegisterOrders, refundRegisterOrder, type RecentOrder } from "./actions";
import { printTickets } from "./print-tickets";
import { sendPrint, targetName, type PrintTarget } from "./printing";

const TZ = "America/Chicago";
const money = (n: number) => `$${n.toFixed(2)}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });

function asReceipt(o: RecentOrder): ReceiptData {
  return {
    orderNumber: o.orderNumber,
    at: o.at,
    cashier: o.cashier,
    member: o.member,
    orderName: o.name,
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, mods: l.mods })),
    subtotal: o.subtotal,
    discounts: o.discounts,
    tax: o.tax,
    tip: o.tip,
    total: o.total,
    payments: [
      { label: "Voucher", amount: o.voucher },
      { label: "Cash", amount: o.cash },
      { label: "Card", amount: o.card },
    ],
    reprint: true,
  };
}

function paidWith(o: RecentOrder) {
  return [o.voucher > 0 && "voucher", o.cash > 0 && "cash", o.card > 0 && "card"].filter(Boolean).join(" + ") || o.method || "—";
}

// The last 20 sales on the register: what was in them, reprint the receipt
// or tickets, refund with a manager PIN.
export default function RecentOrders({ target }: { target: PrintTarget | null }) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string; certUrl?: string } | null>(null);
  const [refunding, setRefunding] = useState(false);

  async function load(keep?: string | null) {
    setLoadError(null);
    const r = await getRecentRegisterOrders().catch(() => null);
    if (!r) return setLoadError("Couldn't load recent orders. Check the connection and try again.");
    setOrders(r);
    setSelectedId(keep && r.some((o) => o.id === keep) ? keep : (r[0]?.id ?? null));
  }

  async function print(label: string, job: () => Promise<PrintResult>, okText: string) {
    setBusy(label);
    setNote(null);
    const r = await job().catch(() => ({ ok: false as const, error: "Couldn't reach the printer." }));
    setBusy(null);
    setNote(r.ok ? { tone: "ok", text: okText } : { tone: "error", text: r.error, certUrl: "certUrl" in r ? r.certUrl : undefined });
  }

  const selected = orders?.find((o) => o.id === selectedId) ?? null;
  const tickets = selected ? selected.lines.filter((l) => l.screeningId).map((l) => ({ screeningId: l.screeningId as string, qty: l.qty })) : [];

  return (
    <>
      <button
        className="btn-secondary whitespace-nowrap py-2 text-sm"
        onClick={() => {
          setOpen(true);
          setNote(null);
          void load(selectedId);
        }}
      >
        Recent
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="card flex h-[85vh] w-full max-w-4xl flex-col !p-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <h3 className="font-display text-xl">Recent orders</h3>
              <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            {loadError ? (
              <p className="p-4 text-sm" style={{ color: "var(--danger-text)" }}>
                {loadError}
              </p>
            ) : !orders ? (
              <p className="p-4 text-sm" style={{ color: "var(--muted)" }}>
                Loading…
              </p>
            ) : orders.length === 0 ? (
              <p className="p-4 text-sm" style={{ color: "var(--muted)" }}>
                No orders yet.
              </p>
            ) : (
              <div className="flex min-h-0 flex-1">
                <ol className="w-64 shrink-0 overflow-y-auto border-r" style={{ borderColor: "var(--border)" }}>
                  {orders.map((o) => (
                    <li key={o.id}>
                      <button
                        className="flex w-full items-start justify-between gap-2 border-b px-3 py-2.5 text-left text-sm"
                        style={{ borderColor: "var(--border)", background: o.id === selectedId ? "var(--accent-soft)" : undefined }}
                        onClick={() => {
                          setSelectedId(o.id);
                          setNote(null);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="font-bold">#{o.orderNumber}</span> <span style={{ color: "var(--muted)" }}>{time(o.at)}</span>
                          <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                            {o.name || o.lines.map((l) => l.name).join(", ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`font-semibold tabular-nums ${o.status !== "completed" ? "line-through opacity-60" : ""}`}>{money(o.total)}</span>
                          {o.status !== "completed" && (
                            <span className="block text-[10px] font-bold uppercase" style={{ color: "var(--danger-text)" }}>
                              {o.status}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>

                {selected && (
                  <div className="min-w-0 flex-1 overflow-y-auto p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="font-display text-2xl">Order #{selected.orderNumber}</h4>
                      <span className="text-sm" style={{ color: "var(--muted)" }}>
                        {day(selected.at)} · {time(selected.at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                      {[selected.name && `For ${selected.name}`, selected.cashier && `Rung up by ${selected.cashier}`, selected.member && `Member: ${selected.member}`, `Paid ${paidWith(selected)}`].filter(Boolean).join(" · ")}
                    </p>
                    {selected.status !== "completed" && (
                      <p className="notice notice-warn mt-2 !p-2 text-sm">This order was {selected.status}.</p>
                    )}

                    <table className="mt-4 w-full text-sm tabular-nums">
                      <tbody>
                        {selected.lines.map((l, i) => (
                          <tr key={i} className="border-b align-top" style={{ borderColor: "var(--border)" }}>
                            <td className="w-10 py-1.5 font-bold">{l.qty}×</td>
                            <td className="py-1.5">
                              {l.name}
                              {l.mods.length > 0 && (
                                <div className="text-xs" style={{ color: "var(--muted)" }}>
                                  {l.mods.join(", ")}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 text-right">{money(l.unit * l.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 space-y-0.5 text-sm tabular-nums">
                      <Row label="Subtotal" value={money(selected.subtotal)} />
                      {selected.discounts.map((d) => (
                        <Row key={d.label} label={d.label} value={`−${money(d.amount)}`} />
                      ))}
                      <Row label="Tax" value={money(selected.tax)} />
                      {selected.tip > 0 && <Row label="Tip" value={money(selected.tip)} />}
                      <Row label="Total" value={money(selected.total)} strong />
                      {selected.voucher > 0 && <Row label="Voucher" value={money(selected.voucher)} muted />}
                      {selected.cash > 0 && <Row label="Cash" value={money(selected.cash)} muted />}
                      {selected.card > 0 && <Row label="Card" value={money(selected.card)} muted />}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        className="btn-primary !px-4"
                        disabled={!target || !!busy}
                        onClick={() =>
                          target &&
                          print("receipt", () => sendPrint(target, "receipt", receiptXml(asReceipt(selected)), `Receipt #${selected.orderNumber} (reprint)`), `Receipt for #${selected.orderNumber} sent to ${targetName(target)}.`)
                        }
                      >
                        {busy === "receipt" ? "Printing…" : "Reprint receipt"}
                      </button>
                      {tickets.length > 0 && (
                        <button
                          className="btn-secondary !px-4"
                          disabled={!target || !!busy}
                          onClick={() => target && print("tickets", () => printTickets(target, selected.orderNumber, tickets), `Tickets for #${selected.orderNumber} sent to ${targetName(target)}.`)}
                        >
                          {busy === "tickets" ? "Printing…" : `Reprint ticket${tickets.reduce((n, t) => n + t.qty, 0) === 1 ? "" : "s"}`}
                        </button>
                      )}
                      {selected.status === "completed" && (
                        <button className="btn-secondary !px-4" style={{ color: "var(--danger-text)" }} disabled={!!busy} onClick={() => setRefunding(true)}>
                          Refund…
                        </button>
                      )}
                    </div>
                    {!target && (
                      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                        No printer is set up on this register. Add it under Devices.
                      </p>
                    )}
                    {note && (
                      <div className={`notice ${note.tone === "ok" ? "notice-success" : "notice-warn"} mt-3 !p-3 text-sm`}>
                        {note.text}
                        {note.certUrl && target?.via === "direct" && (
                          <p className="mt-2">
                            The iPad may need to trust the printer again: open{" "}
                            <a className="font-bold underline" href={note.certUrl} target="_blank" rel="noreferrer">
                              {printerBaseUrl(target.address)}
                            </a>
                            , tap <strong>Show Details → visit this website</strong>, then come back and try again.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {refunding && selected && (
        <ManagerPinModal
          description={`Refund order #${selected.orderNumber} (${money(selected.total)})? ${selected.card > 0 ? "The card part goes back to the card. " : ""}${selected.cash > 0 ? `Hand back ${money(selected.cash)} cash.` : ""}`}
          onCancel={() => setRefunding(false)}
          onSubmit={async (pin) => {
            const r = await refundRegisterOrder(selected.id, pin);
            if (!r.ok) throw new Error(r.error);
            setRefunding(false);
            setNote({ tone: "ok", text: `Order #${selected.orderNumber} refunded.${selected.cash > 0 ? ` Hand back ${money(selected.cash)} cash.` : ""} ${approvalText(r)}` });
            await load(selected.id);
          }}
        />
      )}
    </>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t pt-1 text-base font-bold" : ""}`} style={{ borderColor: "var(--border)", color: muted ? "var(--muted)" : undefined }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
