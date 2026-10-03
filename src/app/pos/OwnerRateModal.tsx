"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/deployment";
import { OWNER_PRICING_TAG } from "@/lib/register-totals";
import { approveOwnerRate, quoteOwnerRate, type OwnerRateApproval, type OwnerRateQuote } from "./owner-rate-actions";
import type { CheckoutLine } from "./actions";

// "Owner rate" on the register: pick whose it is (only the people ticked in
// Back office, Owner tab), see the order at the owner rate (every line and
// the total, priced by the server), then that owner types their own PIN.
// Nobody else's PIN works, so the owner rate can't be given to someone
// else, and the PIN approves just the order shown.

export type OwnerRateOn = Extract<OwnerRateApproval, { ok: true }>;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function OwnerRateModal({
  owners,
  lines,
  onApproved,
  onCancel,
}: {
  owners: { id: string; name: string }[];
  lines: CheckoutLine[]; // the order as rung
  onApproved: (approval: OwnerRateOn) => void;
  onCancel: () => void;
}) {
  // The order as it was when this opened (the box covers the register).
  const [sent] = useState(lines);
  const [quote, setQuote] = useState<OwnerRateQuote | null>(null);
  // One owner: straight to their PIN.
  const [pick, setPick] = useState<{ id: string; name: string } | null>(owners.length === 1 ? owners[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    quoteOwnerRate(sent)
      .then((q) => live && setQuote(q))
      .catch((e) => live && setQuote({ ok: false, error: isStaleBuildError(e) ? STALE_BUILD_MESSAGE : "Couldn't reach the server. Close this and try again." }));
    return () => {
      live = false;
    };
  }, [sent]);

  async function submit() {
    if (!pick || busy || pin.length < 4 || !quote?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await approveOwnerRate(pick.id, pin, sent, quote.totals.total);
      if (r.ok) return onApproved(r);
      setError(r.error);
      setPin("");
    } catch (e) {
      setError(isStaleBuildError(e) ? STALE_BUILD_MESSAGE : "Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-h-[92vh] w-full max-w-sm overflow-y-auto text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {!pick ? "Owner rate: whose?" : quote?.ok ? `${first(pick.name)}, put ${money(quote.totals.total)} on your tab?` : `${first(pick.name)}'s owner rate`}
          <InfoTip topic="owner-rate" />
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Menu items at cost, on the owner&apos;s monthly tab. Only the owner, with their own PIN, for just this order.
        </p>

        {/* The order at the owner rate, as the server priced it. */}
        {!quote ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            Pricing the order...
          </p>
        ) : !quote.ok ? (
          <p className="mt-3 rounded-md border p-2 text-left text-sm" style={{ borderColor: "var(--danger-text)", color: "var(--danger-text)" }} role="alert">
            {quote.error}
          </p>
        ) : (
          <div className="mt-3 rounded-md border p-2 text-left text-sm tabular-nums" style={{ borderColor: "var(--border)" }}>
            <ul className="space-y-1">
              {quote.lines.map((l, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1">
                    {l.quantity > 1 ? `${l.quantity} × ` : ""}
                    {l.name}
                    <span className="block text-[11px]" style={{ color: l.owner_pricing === "half" ? "var(--danger-text)" : "var(--muted)" }}>
                      {OWNER_PRICING_TAG[l.owner_pricing]}
                      {l.unit_price !== l.menu_unit_price ? `, menu ${money(l.menu_unit_price * l.quantity)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0">{money(l.unit_price * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 space-y-0.5 border-t pt-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{money(quote.totals.tax)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                <span>On the tab</span>
                <span>{money(quote.totals.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>Menu value</span>
                <span>{money(quote.menuValue)}</span>
              </div>
            </div>
          </div>
        )}

        {quote?.ok &&
          (!pick ? (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {owners.map((o) => (
                <button key={o.id} className="btn-secondary min-h-14 !text-base" onClick={() => setPick(o)}>
                  {first(o.name)}
                </button>
              ))}
            </div>
          ) : (
            <>
              <label className="mt-4 block text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                {first(pick.name)}, enter your PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  aria-label={`${first(pick.name)}'s PIN`}
                  className="input mt-2 min-h-12 text-center text-lg tracking-[0.5em]"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                />
              </label>
              {error && (
                <div className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                  {error}
                </div>
              )}
              <button className="btn-primary mt-4 min-h-12 w-full !text-base" disabled={busy || pin.length < 4} onClick={() => void submit()}>
                {busy ? "Checking..." : "Approve"}
              </button>
              {owners.length > 1 && (
                <button
                  className="mt-2 min-h-11 text-sm hover:underline"
                  style={{ color: "var(--muted)" }}
                  onClick={() => {
                    setPick(null);
                    setPin("");
                    setError(null);
                  }}
                >
                  Not {first(pick.name)}? Pick again
                </button>
              )}
            </>
          ))}

        <button className="mt-2 block min-h-11 w-full text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
