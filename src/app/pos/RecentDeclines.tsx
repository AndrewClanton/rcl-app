"use client";

import { useState } from "react";
import { declineReason, cardLine } from "@/lib/decline-slip";
import { declineSlipXml } from "@/lib/print/receipt";
import { getRecentDeclines, type RecentDecline } from "./decline-actions";
import { sendPrint, targetName, type PrintTarget } from "./printing";

// Declined cards today (from Stripe), each with "Print decline slip": the
// exact reason and codes on paper, for the guest to take to their bank,
// instead of staff explaining it secondhand. Covers the reader and
// Insiders+ signups (at the register or on the guest's phone).

const TZ = "America/Chicago";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

export default function RecentDeclines({ target }: { target: PrintTarget | null }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<RecentDecline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function load() {
    setError(null);
    setList(null);
    const r = await getRecentDeclines().catch(() => null);
    if (!r) return setError("Couldn't load declines. Check the connection and try again.");
    if (!r.ok) return setError(r.error);
    setList(r.declines);
  }

  async function print(d: RecentDecline) {
    if (!target) return setNote({ tone: "error", text: "No printer is set up for this register. Pick one under Devices." });
    setBusy(d.chargeId);
    setNote(null);
    const r = await sendPrint(target, "receipt", declineSlipXml(d), `Decline slip ${d.chargeId}`).catch(() => ({ ok: false as const, error: "Couldn't reach the printer." }));
    setBusy(null);
    setNote(r.ok ? { tone: "ok", text: `Decline slip sent to ${targetName(target)}.` } : { tone: "error", text: r.error });
  }

  return (
    <>
      <button
        className="btn-secondary whitespace-nowrap py-2 text-sm"
        onClick={() => {
          setOpen(true);
          setNote(null);
          void load();
        }}
      >
        Declines
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col !p-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <h3 className="font-display text-xl">Declined cards today</h3>
              <div className="flex gap-3">
                <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => void load()}>
                  Refresh
                </button>
                <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <p className="px-4 pt-2 text-xs" style={{ color: "var(--muted)" }}>
              Print a slip for the guest: it shows the bank&apos;s reason and the codes their bank needs. Memberships started on a phone show up here too.
            </p>
            {note && (
              <p className={`notice ${note.tone === "ok" ? "notice-success" : "notice-warn"} mx-4 mt-2 !p-2 text-sm`}>{note.text}</p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {error ? (
                <p className="text-sm" style={{ color: "var(--danger-text)" }}>
                  {error}
                </p>
              ) : !list ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Loading…
                </p>
              ) : list.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  No declined cards today.
                </p>
              ) : (
                <ul className="space-y-2">
                  {list.map((d) => (
                    <li key={d.chargeId} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          <span className="font-bold">{time(d.at)}</span> · <span className="font-semibold tabular-nums">{money(d.amountCents)}</span> · {d.purpose}
                          {d.who ? ` · ${d.who}` : ""}
                        </span>
                        <button className="btn-primary !py-1.5 text-sm" disabled={busy === d.chargeId} onClick={() => void print(d)}>
                          {busy === d.chargeId ? "Printing…" : "Print decline slip"}
                        </button>
                      </div>
                      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                        {cardLine(d.brand, d.funding, d.last4)} · {d.online ? "online / monthly" : "on the reader"} · {declineReason(d.declineCode, d.failureCode)}
                        {d.declineCode ? ` (${d.declineCode}${d.networkCode ? `, network ${d.networkCode}` : ""})` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
