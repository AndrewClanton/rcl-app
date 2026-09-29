"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutPayment } from "./actions";
import { startReaderPayment, checkReaderPayment, cancelReaderPayment } from "./terminal-actions";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/deployment";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// What the customer is likely handing over: the exact amount, then the next
// whole dollar and the usual bills above the total.
function tenderChoices(total: number) {
  const cents = Math.round(total * 100);
  const options = [cents, Math.ceil(cents / 100) * 100, Math.ceil(cents / 500) * 500, Math.ceil(cents / 1000) * 1000, 2000, 5000, 10000];
  return [...new Set(options.filter((c) => c >= cents))].slice(0, 6).map((c) => c / 100);
}

// Paper vouchers ($10/$20, the trivia prizes): tap one per voucher handed
// over, or type an odd amount. Vouchers never give change: if they cover the
// whole order it's paid; otherwise cash or card pays the rest.
function VoucherTender({ total, onBack, onPaidInFull, onPartial }: { total: number; onBack: () => void; onPaidInFull: () => void; onPartial: (amount: number) => void }) {
  const [vouchers, setVouchers] = useState<number[]>([]);
  const [typed, setTyped] = useState("");
  const sum = Math.round(vouchers.reduce((s, v) => s + v, 0) * 100) / 100;
  const covers = sum + 0.001 >= total;
  const leftOver = Math.round((sum - total) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Voucher · {money(total)} due
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Tap once for each voucher they hand you.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[5, 10, 20].map((v) => (
            <button key={v} className="chip !py-3 !text-base font-bold" onClick={() => setVouchers((l) => [...l, v])}>
              + ${v}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input className="input flex-1 text-center" inputMode="decimal" placeholder="Other amount" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ""))} />
          <button
            className="btn-secondary !px-4"
            disabled={!(parseFloat(typed) > 0)}
            onClick={() => {
              setVouchers((l) => [...l, Math.round(parseFloat(typed) * 100) / 100]);
              setTyped("");
            }}
          >
            Add
          </button>
        </div>
        <div className="mt-4 rounded-lg py-3" style={{ background: "var(--surface-hover)" }}>
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {vouchers.length ? `${vouchers.length} voucher${vouchers.length === 1 ? "" : "s"}: ${vouchers.map((v) => money(v).replace(".00", "")).join(" + ")}` : "No vouchers yet"}
          </div>
          <div className="font-display text-4xl" style={{ color: "var(--accent)" }}>
            {money(sum)}
          </div>
          {vouchers.length > 0 && (
            <button className="mt-1 text-xs underline" style={{ color: "var(--muted)" }} onClick={() => setVouchers([])}>
              Start over
            </button>
          )}
        </div>
        {covers && leftOver > 0 && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {money(leftOver)} left on the voucher isn&apos;t given back as change.
          </p>
        )}
        <button
          className="btn-primary mt-4 w-full py-3 text-base"
          disabled={sum === 0}
          onClick={() => (covers ? onPaidInFull() : onPartial(sum))}
        >
          {sum === 0 ? "Add a voucher" : covers ? "Done · paid with vouchers" : `Use ${money(sum)} · pay the other ${money(total - sum)}`}
        </button>
        <button className="mt-3 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

// Cash: tap what they handed you (or type it) and the change due shows big
// before the sale is finished.
function CashTender({ total, onBack, onDone }: { total: number; onBack: () => void; onDone: (tendered: number) => void }) {
  const [given, setGiven] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const tendered = typed ? parseFloat(typed) || 0 : given;
  const short = tendered !== null && tendered + 0.001 < total;
  const change = tendered !== null && !short ? Math.round((tendered - total) * 100) / 100 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Cash · {money(total)} due
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          How much did they hand you?
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {tenderChoices(total).map((amt, i) => (
            <button
              key={amt}
              className={`chip !py-3 !text-base font-bold ${given === amt && !typed ? "chip-selected" : ""}`}
              onClick={() => {
                setTyped("");
                setGiven(amt);
              }}
            >
              {i === 0 ? "Exact" : money(amt).replace(".00", "")}
            </button>
          ))}
        </div>
        <input
          className="input mt-3 text-center"
          inputMode="decimal"
          placeholder="Other amount"
          value={typed}
          onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <div className="mt-4 rounded-lg py-3" style={{ background: "var(--surface-hover)" }}>
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Change due
          </div>
          <div className="font-display text-4xl" style={{ color: short ? "var(--danger-text)" : "var(--accent)" }}>
            {short ? `${money(total - (tendered ?? 0))} short` : change === null ? "—" : money(change)}
          </div>
        </div>
        <button className="btn-primary mt-4 w-full py-3 text-base" disabled={change === null} onClick={() => change !== null && tendered !== null && onDone(tendered)}>
          {change === null ? "Pick the amount given" : change > 0 ? `Done · give ${money(change)} change` : "Done · no change"}
        </button>
        <button className="mt-3 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

type ReaderState = "waiting" | "failed";

export default function PaymentModal({
  total,
  readerId,
  tipEligible,
  onConfirm,
  onCancel,
}: {
  total: number;
  readerId: string | null; // this register's card reader, or null if none is set up
  tipEligible: number | null; // pre-tax amount the reader's tip suggestions use; null skips the tip screen
  onConfirm: (payment: CheckoutPayment) => void;
  onCancel: () => void;
}) {
  const [splitOpen, setSplitOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  // Paper vouchers applied so far; cash or card covers the rest (`due`).
  const [voucher, setVoucher] = useState(0);
  const due = Math.round((total - voucher) * 100) / 100;
  const withVoucher = voucher > 0 ? { voucher } : {};
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [error, setError] = useState(false);
  const [reader, setReader] = useState<{ state: ReaderState; paymentIntentId: string; message?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The payment being watched; cleared on cancel/close so a check that's
  // still on its way back doesn't start another.
  const watchingRef = useRef<string | null>(null);
  // A paid payment completes the sale exactly once, however many checks see it.
  const confirmedRef = useRef(false);

  function stopWatching() {
    watchingRef.current = null;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }

  useEffect(() => stopWatching, []);

  async function handleReaderCharge() {
    setReader(null);
    try {
      if (!readerId) return;
      const started = await startReaderPayment(Math.round(due * 100), readerId, tipEligible === null ? null : Math.round(tipEligible * 100));
      if (!started.ok) {
        setReader({ state: "failed", paymentIntentId: "", message: started.error });
        return;
      }
      const { paymentIntentId } = started;
      setReader({ state: "waiting", paymentIntentId });
      watchingRef.current = paymentIntentId;
      // One check at a time: the next starts 1.5s after the last one answers.
      // (A fixed interval let a slow check overlap the next, both saw
      // "succeeded", and the sale was saved and printed twice.)
      const check = async () => {
        pollRef.current = null;
        let again = true;
        try {
          const { status, errorMessage, amountCents, tipCents } = await checkReaderPayment(paymentIntentId);
          if (status === "succeeded") {
            again = false;
            watchingRef.current = null;
            if (!confirmedRef.current) {
              confirmedRef.current = true;
              onConfirm({ method: "card", cash: 0, card: amountCents / 100, stripePaymentIntentId: paymentIntentId, tip: tipCents / 100, ...withVoucher });
            }
          } else if (status === "canceled") {
            again = false;
            setReader({ state: "failed", paymentIntentId, message: errorMessage ?? "Payment was canceled." });
          } else if (errorMessage) {
            // requires_payment_method after a decline -- reader auto-prompts retry, but surface the message.
            setReader({ state: "waiting", paymentIntentId, message: errorMessage });
          }
        } catch (e) {
          // A deploy landed mid-payment: this page can't check the charge
          // anymore, and the card may already be charged. Stop and say so,
          // rather than waiting forever or inviting a second charge.
          if (isStaleBuildError(e)) {
            again = false;
            setReader({
              state: "failed",
              paymentIntentId,
              message: "The register was updated during this payment. Refresh the page, then check Stripe's Payments list before charging again: the card may already be charged.",
            });
          }
          // Anything else is a transient poll failure -- keep waiting, next tick retries.
        }
        if (again && watchingRef.current === paymentIntentId) pollRef.current = setTimeout(check, 1500);
      };
      pollRef.current = setTimeout(check, 1500);
    } catch (e) {
      setReader({ state: "failed", paymentIntentId: "", message: isStaleBuildError(e) ? STALE_BUILD_MESSAGE : e instanceof Error ? e.message : "Could not reach the card reader." });
    }
  }

  async function handleCancelReader() {
    stopWatching();
    if (reader?.paymentIntentId && readerId) await cancelReaderPayment(reader.paymentIntentId, readerId).catch(() => {});
    setReader(null);
  }

  if (cashOpen) {
    return <CashTender total={due} onBack={() => setCashOpen(false)} onDone={(tendered) => onConfirm({ method: "cash", cash: due, card: 0, tendered, ...withVoucher })} />;
  }

  if (voucherOpen) {
    return (
      <VoucherTender
        total={total}
        onBack={() => setVoucherOpen(false)}
        onPaidInFull={() => onConfirm({ method: "voucher", cash: 0, card: 0, voucher: total })}
        onPartial={(amount) => {
          setVoucher(amount);
          setVoucherOpen(false);
        }}
      />
    );
  }

  if (reader) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="card w-full max-w-xs text-center shadow-2xl">
          {reader.state === "waiting" ? (
            <>
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                Present card on reader
              </h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                Total due:{" "}
                <strong className="text-lg" style={{ color: "var(--accent)" }}>
                  {money(due)}
                </strong>
              </p>
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Waiting for the customer to tap, insert, or swipe on the reader...
              </p>
              {reader.message && (
                <p className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                  {reader.message}
                </p>
              )}
              <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={handleCancelReader}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                Card reader error
              </h3>
              <p className="mt-2 text-sm" style={{ color: "var(--danger-text)" }}>
                {reader.message}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button className="btn-secondary" onClick={() => setReader(null)}>
                  Back
                </button>
                <button className="btn-primary" onClick={handleReaderCharge}>
                  Try again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-xs text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Take payment
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {voucher > 0 ? "Left to pay:" : "Total due:"}{" "}
          <strong className="text-lg" style={{ color: "var(--accent)" }}>
            {money(due)}
          </strong>
        </p>
        {voucher > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {money(total)} total · {money(voucher)} in vouchers ·{" "}
            <button className="underline" onClick={() => setVoucher(0)}>
              remove
            </button>
          </p>
        )}

        {!splitOpen ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn-secondary px-4 py-2" onClick={() => setCashOpen(true)}>
              Cash
            </button>
            {readerId ? (
              <button className="btn-secondary px-4 py-2" onClick={handleReaderCharge}>
                Card (reader)
              </button>
            ) : (
              <button className="btn-secondary px-4 py-2" onClick={() => onConfirm({ method: "card", cash: 0, card: due, ...withVoucher })}>
                Card
              </button>
            )}
            <button className="btn-secondary px-4 py-2" onClick={() => setSplitOpen(true)}>
              Split
            </button>
            {voucher === 0 && (
              <button className="btn-secondary px-4 py-2" onClick={() => setVoucherOpen(true)}>
                Voucher
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-2 text-left">
            <div>
              <label className="label-xs">Cash amount</label>
              <input type="number" step="0.01" min="0" className="input" value={cash} onChange={(e) => setCash(e.target.value)} />
            </div>
            <div>
              <label className="label-xs">Card amount</label>
              <input type="number" step="0.01" min="0" className="input" value={card} onChange={(e) => setCard(e.target.value)} />
            </div>
            {error && (
              <div className="text-xs" style={{ color: "var(--danger-text)" }}>
                Cash + card must equal the total due.
              </div>
            )}
            <button
              className="btn-primary w-full"
              onClick={() => {
                const c = parseFloat(cash) || 0;
                const cd = parseFloat(card) || 0;
                if (Math.abs(c + cd - due) > 0.01) {
                  setError(true);
                  return;
                }
                onConfirm({ method: "split", cash: c, card: cd, ...withVoucher });
              }}
            >
              Confirm split
            </button>
          </div>
        )}

        <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
