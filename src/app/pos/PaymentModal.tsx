"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutPayment } from "./actions";
import { startReaderPayment, checkReaderPayment, cancelReaderPayment, askTipOnReader, askCustomTipOnReader, readTipAnswer, cancelReaderQuestion } from "./terminal-actions";
import { chargeTabCard } from "./tab-card-actions";
import TipModal from "./TipModal";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/deployment";
import InfoTip from "@/components/help/InfoTip";

// Split is hidden: it recorded the card part as paid without ever sending it
// to the reader. It comes back once it takes the cash here and charges the
// rest on the reader.
const SPLIT_ENABLED = false;

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
          <InfoTip topic="vouchers" />
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

// A deploy landed mid-payment: this page can't check the charge anymore,
// and the card may already be charged.
const STALE_MID_PAYMENT = "The register was updated during this payment. Refresh the page, then check Stripe's Payments list before charging again: the card may already be charged.";

export default function PaymentModal({
  total,
  readerId,
  tipEligible,
  tabCard = null,
  tabName = "Tab",
  onConfirm,
  onCancel,
}: {
  total: number;
  readerId: string | null; // this register's card reader, or null if none is set up
  tipEligible: number | null; // pre-tax amount the reader's tip suggestions use; null skips the tip screen
  tabCard?: { tabId: string; label: string } | null; // the tab's card on file, charged without a tap
  tabName?: string;
  onConfirm: (payment: CheckoutPayment, note?: string) => void; // note: shown to staff with the sale
  onCancel: () => void;
}) {
  const [splitOpen, setSplitOpen] = useState(false);
  const [onFile, setOnFile] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  // Charging the card on file has no tap, so no reader tip screen: the tip is
  // asked here first (what they wrote on the slip, or told the bartender).
  const [onFileTipOpen, setOnFileTipOpen] = useState(false);
  // The tip question on the reader, for the card on file (no tap, so the
  // reader's own tip screen never appears).
  const [readerTip, setReaderTip] = useState<{ phase: "asking" | "custom" | "failed"; message?: string } | null>(null);
  const tipPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipAskRef = useRef(0);
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
  // Cancel was tapped on this payment, so a charge that still went through
  // gets a note saying so (staff would otherwise think it was canceled).
  const cancelTappedRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);

  function stopWatching() {
    watchingRef.current = null;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }

  useEffect(() => stopWatching, []);

  // The one way a paid reader payment becomes a sale, whether the watch
  // below saw it or the last look after Cancel did.
  function confirmReaderPayment(paymentIntentId: string, amountCents: number, tipCents: number) {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    const note = cancelTappedRef.current ? "The card went through before Cancel. The sale was recorded." : undefined;
    onConfirm({ method: "card", cash: 0, card: amountCents / 100, stripePaymentIntentId: paymentIntentId, tip: tipCents / 100, ...withVoucher }, note);
  }

  function watchReaderPayment(paymentIntentId: string) {
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
          // Recorded even if Cancel was tapped meanwhile: the card is charged.
          again = false;
          watchingRef.current = null;
          confirmReaderPayment(paymentIntentId, amountCents, tipCents);
        } else if (watchingRef.current !== paymentIntentId) {
          // Cancel was tapped while this check was out; Cancel decides what shows next.
          again = false;
        } else if (status === "canceled") {
          again = false;
          setReader({ state: "failed", paymentIntentId, message: errorMessage ?? "Payment was canceled." });
        } else if (errorMessage) {
          // requires_payment_method after a decline -- reader auto-prompts retry, but surface the message.
          setReader({ state: "waiting", paymentIntentId, message: errorMessage });
        }
      } catch (e) {
        // A deploy landed mid-payment: stop and say so, rather than waiting
        // forever or inviting a second charge.
        if (isStaleBuildError(e) && watchingRef.current === paymentIntentId) {
          again = false;
          setReader({ state: "failed", paymentIntentId, message: STALE_MID_PAYMENT });
        }
        // Anything else is a transient poll failure -- keep waiting, next tick retries.
      }
      if (again && watchingRef.current === paymentIntentId) pollRef.current = setTimeout(check, 1500);
    };
    pollRef.current = setTimeout(check, 1500);
  }

  async function handleReaderCharge() {
    setReader(null);
    cancelTappedRef.current = false;
    try {
      if (!readerId) return;
      const started = await startReaderPayment(Math.round(due * 100), readerId, tipEligible === null ? null : Math.round(tipEligible * 100));
      if (!started.ok) {
        setReader({ state: "failed", paymentIntentId: "", message: started.error });
        return;
      }
      const { paymentIntentId } = started;
      setReader({ state: "waiting", paymentIntentId });
      watchReaderPayment(paymentIntentId);
    } catch (e) {
      setReader({ state: "failed", paymentIntentId: "", message: isStaleBuildError(e) ? STALE_BUILD_MESSAGE : e instanceof Error ? e.message : "Could not reach the card reader." });
    }
  }

  const tipBaseCents = Math.round((tipEligible ?? due) * 100);

  function stopTipPoll() {
    tipAskRef.current += 1;
    if (tipPollRef.current) clearTimeout(tipPollRef.current);
    tipPollRef.current = null;
  }

  useEffect(() => () => {
    if (tipPollRef.current) clearTimeout(tipPollRef.current);
  }, []);

  // "Charge card on file": ask the customer on the reader. No reader on
  // this register: ask here instead.
  async function startCardOnFile() {
    if (!tabCard || onFile.busy) return;
    if (!readerId) return setOnFileTipOpen(true);
    stopTipPoll();
    const ask = tipAskRef.current;
    setReaderTip({ phase: "asking" });
    const r = await askTipOnReader(readerId, tipBaseCents, Math.round(due * 100)).catch(() => ({ ok: false as const, error: "Couldn't reach the card reader." }));
    if (ask !== tipAskRef.current) return;
    if (!r.ok) return setReaderTip({ phase: "failed", message: r.error });
    pollTip(ask, "asking");
  }

  function pollTip(ask: number, phase: "asking" | "custom") {
    const check = async () => {
      if (ask !== tipAskRef.current || !readerId) return;
      const a = await readTipAnswer(readerId).catch(() => ({ status: "waiting" as const }));
      if (ask !== tipAskRef.current) return;
      if (a.status === "waiting") {
        tipPollRef.current = setTimeout(check, 1200);
        return;
      }
      if (a.status === "failed") return setReaderTip({ phase: "failed", message: a.message });
      if (phase === "custom") {
        const dollars = parseInt(String(a.numeric ?? "").replace(/[^0-9]/g, ""), 10);
        if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1000) return setReaderTip({ phase: "failed", message: "That tip didn't come through as a number. Try again, or enter it here." });
        setReaderTip(null);
        return handleCardOnFile(dollars);
      }
      if (a.choice === "other") {
        setReaderTip({ phase: "custom" });
        const r = await askCustomTipOnReader(readerId).catch(() => ({ ok: false as const, error: "Couldn't reach the card reader." }));
        if (ask !== tipAskRef.current) return;
        if (!r.ok) return setReaderTip({ phase: "failed", message: r.error });
        return pollTip(ask, "custom");
      }
      const pct = a.choice === "p15" ? 0.15 : a.choice === "p20" ? 0.2 : a.choice === "p25" ? 0.25 : 0;
      setReaderTip(null);
      return handleCardOnFile(Math.round(tipBaseCents * pct) / 100);
    };
    tipPollRef.current = setTimeout(check, 1200);
  }

  async function cancelReaderTip(enterHere: boolean) {
    stopTipPoll();
    if (readerId) await cancelReaderQuestion(readerId).catch(() => {});
    setReaderTip(null);
    if (enterHere) setOnFileTipOpen(true);
  }

  // The tab's saved card: charged for what's due plus the tip (from the
  // reader, or TipModal here), no tap needed.
  async function handleCardOnFile(tipAmount: number) {
    setOnFileTipOpen(false);
    if (!tabCard || onFile.busy) return;
    const tipCents = Math.max(0, Math.round(tipAmount * 100));
    setOnFile({ busy: true, error: null });
    const r = await chargeTabCard(tabCard.tabId, Math.round(due * 100) + tipCents).catch(() => ({ ok: false as const, error: "Couldn't reach Stripe. Try again." }));
    if (!r.ok) return setOnFile({ busy: false, error: r.error });
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    // Like a reader sale: the card amount is everything charged, tip included.
    onConfirm({ method: "card", cash: 0, card: r.amountCents / 100, stripePaymentIntentId: r.paymentIntentId, tip: tipCents / 100, ...withVoucher });
  }

  async function handleCancelReader() {
    if (!reader?.paymentIntentId || cancelling) return;
    const { paymentIntentId } = reader;
    stopWatching();
    cancelTappedRef.current = true;
    setCancelling(true);
    await cancelReaderPayment(paymentIntentId, readerId ?? "").catch(() => {});
    // Stripe can't cancel a payment that already went through: a card tapped
    // a moment before Cancel stays charged. Look once more, so that sale is
    // recorded instead of the screen going back to "Take payment" (and the
    // card getting charged a second time).
    const last = await checkReaderPayment(paymentIntentId).catch((e: unknown) => (isStaleBuildError(e) ? ("stale" as const) : null));
    setCancelling(false);
    if (last === "stale") return setReader({ state: "failed", paymentIntentId, message: STALE_MID_PAYMENT });
    if (last?.status === "succeeded") return confirmReaderPayment(paymentIntentId, last.amountCents, last.tipCents);
    if (last?.status === "canceled") return setReader(null);
    // Neither paid nor canceled (the cancel didn't take, or Stripe didn't
    // answer): keep watching rather than offer a second charge.
    setReader({ state: "waiting", paymentIntentId, message: "Cancel didn't go through. Wait for the reader, or tap Cancel again." });
    watchReaderPayment(paymentIntentId);
  }

  if (readerTip) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="card w-full max-w-xs text-center shadow-2xl">
          {readerTip.phase === "failed" ? (
            <>
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                The reader didn&apos;t get a tip
              </h3>
              <p className="mt-2 text-sm" style={{ color: "var(--danger-text)" }}>
                {readerTip.message}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button className="btn-primary" onClick={() => void startCardOnFile()}>
                  Ask on the reader again
                </button>
                <button className="btn-secondary" onClick={() => void cancelReaderTip(true)}>
                  Enter the tip here
                </button>
                <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => void cancelReaderTip(false)}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                {readerTip.phase === "custom" ? "Customer is typing a tip" : "Customer is picking a tip"}
                <InfoTip topic="card-on-file-tip" />
              </h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                On the card reader. Then {tabCard?.label ?? "the card on file"} is charged {money(due)} plus the tip.
              </p>
              {onFile.error && (
                <p className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                  {onFile.error}
                </p>
              )}
              <div className="mt-4 flex flex-col gap-2">
                <button className="btn-secondary" onClick={() => void cancelReaderTip(true)}>
                  Enter the tip here instead
                </button>
                <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => void cancelReaderTip(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (onFileTipOpen) {
    return <TipModal subtotal={tipEligible ?? due} tabName={tabName} onConfirm={handleCardOnFile} onCancel={() => setOnFileTipOpen(false)} />;
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
              <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} disabled={cancelling} onClick={handleCancelReader}>
                {cancelling ? "Cancelling..." : "Cancel"}
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

        {tabCard && !splitOpen && (
          <div className="mt-4">
            <button className="btn-primary w-full py-3 text-base" disabled={onFile.busy} onClick={() => void startCardOnFile()}>
              {onFile.busy ? "Charging..." : `Charge card on file · ${tabCard.label}`}
            </button>
            {/* The tip question: asked on the reader, since a card on file has no tap. */}
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {readerId ? "They pick a tip on the reader first." : "You enter their tip here first."}
              <InfoTip topic="card-on-file-tip" />
            </p>
            {onFile.error && (
              <p className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                {onFile.error}
              </p>
            )}
          </div>
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
            {SPLIT_ENABLED && (
              <button className="btn-secondary px-4 py-2" onClick={() => setSplitOpen(true)}>
                Split
              </button>
            )}
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
