"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutPayment } from "./actions";
import { startReaderPayment, checkReaderPayment, cancelReaderPayment, askTipOnReader, askCustomTipOnReader, readTipAnswer, cancelReaderQuestion } from "./terminal-actions";
import { chargeTabCard } from "./tab-card-actions";
import TipModal from "./TipModal";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/deployment";
import InfoTip from "@/components/help/InfoTip";

// Split: the cash part is taken first (change worked out, like Cash), then
// the rest goes to this register's card reader, and the sale is saved as
// cash + card once the card goes through. It needs a reader, so a register
// without one doesn't offer it. (Set false to hide it again.)
const SPLIT_ENABLED = true;

// Stripe won't charge a card less than 50 cents.
const MIN_CARD = 0.5;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function toCents(n: number) {
  return Math.round(n * 100) / 100;
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
        <button className="btn-quiet mt-3" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

// Cash: tap what they handed you (or type it) and the change due shows big
// before the sale is finished. `then`: the card part still to come, when
// this is the cash part of a split. Its change is given at the end, like
// any sale's (the drawer opens once the card has gone through), so a card
// that fails means handing back just what they gave.
function CashTender({ total, then, onBack, onDone }: { total: number; then?: number; onBack: () => void; onDone: (tendered: number) => void }) {
  const [given, setGiven] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const tendered = typed ? parseFloat(typed) || 0 : given;
  const short = tendered !== null && tendered + 0.001 < total;
  const change = tendered !== null && !short ? Math.round((tendered - total) * 100) / 100 : null;
  const done = change === null ? "Pick the amount given" : change > 0 ? `Done · give ${money(change)} change` : "Done · no change";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {then === undefined ? "Cash" : "Cash part"} · {money(total)} due
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          How much did they hand you?{then !== undefined && ` Then ${money(then)} goes on the card.`}
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
          {then !== undefined && !!change && (
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Give it after the card goes through.
            </div>
          )}
        </div>
        <button className="btn-primary mt-4 w-full py-3 text-base" disabled={change === null} onClick={() => change !== null && tendered !== null && onDone(tendered)}>
          {then === undefined || change === null ? done : `Next · ${money(then)} on the card`}
        </button>
        <button className="btn-quiet mt-3" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

// Split, step 1: how much they're paying in cash. The rest goes on the card
// after the cash is taken.
function SplitAmount({ due, initial, onBack, onNext }: { due: number; initial: number; onBack: () => void; onNext: (cash: number) => void }) {
  const [typed, setTyped] = useState(initial > 0 ? String(initial) : "");
  const cash = toCents(parseFloat(typed) || 0);
  const card = toCents(due - cash);
  const problem = !(cash > 0) ? null : card <= 0 ? "That's the whole amount. Go back and use Cash." : card < MIN_CARD ? `The card part has to be at least ${money(MIN_CARD)}. Take a little less cash.` : null;
  const ready = cash > 0 && !problem;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          Split · {money(due)} due
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          How much are they paying in cash? The rest goes on the card.
        </p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[5, 10, 20, 50]
            .filter((v) => v <= due - MIN_CARD)
            .map((v) => (
              <button key={v} className={`chip !py-3 !text-base font-bold ${cash === v ? "chip-selected" : ""}`} onClick={() => setTyped(String(v))}>
                ${v}
              </button>
            ))}
        </div>
        <input className="input mt-3 text-center" inputMode="decimal" placeholder="Cash amount" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ""))} />
        <div className="mt-4 grid grid-cols-2 rounded-lg py-3" style={{ background: "var(--surface-hover)" }}>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Cash
            </div>
            <div className="font-display text-3xl" style={{ color: "var(--accent)" }}>
              {money(cash)}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Card
            </div>
            <div className="font-display text-3xl" style={{ color: "var(--accent)" }}>
              {ready ? money(card) : "—"}
            </div>
          </div>
        </div>
        {problem && (
          <p className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
            {problem}
          </p>
        )}
        <button className="btn-primary mt-4 w-full py-3 text-base" disabled={!ready} onClick={() => onNext(cash)}>
          {ready ? `Take the ${money(cash)} cash first` : "Enter the cash part"}
        </button>
        <button className="btn-quiet mt-3" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

// The cash part of a split, once it's in hand. It rides along with the
// reader payment for the rest, so the sale saves as cash + card.
type Split = { cash: number; tendered: number };

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
  // Split: picking the cash part, then taking it. The card part comes after.
  const [splitStep, setSplitStep] = useState<"amount" | "cash" | null>(null);
  const [splitCash, setSplitCash] = useState(0);
  // A split whose card part didn't go through: the cash has to go back.
  const [splitNote, setSplitNote] = useState<string | null>(null);
  // Asking Stripe to send the charge to the reader (a second or so).
  const [sending, setSending] = useState(false);
  // split: the cash already taken when the reader is charging a split's
  // card part (for the screen, and for how the sale is saved).
  const [reader, setReader] = useState<{ state: ReaderState; paymentIntentId: string; message?: string; split: Split | null } | null>(null);
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

  // What the reader charges: everything due, or what's left after a split's cash.
  const cardPart = (split: Split | null) => (split ? toCents(due - split.cash) : due);

  function stopWatching() {
    watchingRef.current = null;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }

  useEffect(() => stopWatching, []);

  // The one way a paid reader payment becomes a sale, whether the watch
  // below saw it or the last look after Cancel did. A split saves the cash
  // it took along with the card.
  function confirmReaderPayment(paymentIntentId: string, amountCents: number, tipCents: number, split: Split | null) {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    const note = cancelTappedRef.current ? "The card went through before Cancel. The sale was recorded." : undefined;
    const cardPaid = { card: amountCents / 100, stripePaymentIntentId: paymentIntentId, tip: tipCents / 100, ...withVoucher };
    onConfirm(split ? { method: "split", cash: split.cash, tendered: split.tendered, ...cardPaid } : { method: "card", cash: 0, ...cardPaid }, note);
  }

  function watchReaderPayment(paymentIntentId: string, split: Split | null) {
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
          confirmReaderPayment(paymentIntentId, amountCents, tipCents, split);
        } else if (watchingRef.current !== paymentIntentId) {
          // Cancel was tapped while this check was out; Cancel decides what shows next.
          again = false;
        } else if (status === "canceled") {
          again = false;
          setReader({ state: "failed", paymentIntentId, message: errorMessage ?? "Payment was canceled.", split });
        } else if (errorMessage) {
          // requires_payment_method after a decline -- reader auto-prompts retry, but surface the message.
          setReader({ state: "waiting", paymentIntentId, message: errorMessage, split });
        }
      } catch (e) {
        // A deploy landed mid-payment: stop and say so, rather than waiting
        // forever or inviting a second charge.
        if (isStaleBuildError(e) && watchingRef.current === paymentIntentId) {
          again = false;
          setReader({ state: "failed", paymentIntentId, message: STALE_MID_PAYMENT, split });
        }
        // Anything else is a transient poll failure -- keep waiting, next tick retries.
      }
      if (again && watchingRef.current === paymentIntentId) pollRef.current = setTimeout(check, 1500);
    };
    pollRef.current = setTimeout(check, 1500);
  }

  // split: charging the rest of a split, after its cash was taken.
  async function handleReaderCharge(split: Split | null = null) {
    setReader(null);
    setSplitNote(null);
    cancelTappedRef.current = false;
    if (!readerId) return;
    const amountCents = Math.round(cardPart(split) * 100);
    // A split's tip suggestions are figured on its card part.
    const tipCents = tipEligible === null ? null : split ? Math.min(Math.round(tipEligible * 100), amountCents) : Math.round(tipEligible * 100);
    setSending(true);
    try {
      const started = await startReaderPayment(amountCents, readerId, tipCents);
      if (!started.ok) {
        setReader({ state: "failed", paymentIntentId: "", message: started.error, split });
        return;
      }
      const { paymentIntentId } = started;
      setReader({ state: "waiting", paymentIntentId, split });
      watchReaderPayment(paymentIntentId, split);
    } catch (e) {
      setReader({ state: "failed", paymentIntentId: "", message: isStaleBuildError(e) ? STALE_BUILD_MESSAGE : e instanceof Error ? e.message : "Could not reach the card reader.", split });
    } finally {
      setSending(false);
    }
  }

  // Back to "Take payment" from the reader. After a split's card part
  // didn't go through, the cash they handed over for it goes back.
  function leaveReader(split: Split | null) {
    setReader(null);
    if (split) setSplitNote(`The card part didn't go through, so this sale isn't paid. Hand back the ${money(split.tendered)} they gave you, then take payment again.`);
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
    const { paymentIntentId, split } = reader;
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
    if (last === "stale") return setReader({ state: "failed", paymentIntentId, message: STALE_MID_PAYMENT, split });
    if (last?.status === "succeeded") return confirmReaderPayment(paymentIntentId, last.amountCents, last.tipCents, split);
    if (last?.status === "canceled") return leaveReader(split);
    // Neither paid nor canceled (the cancel didn't take, or Stripe didn't
    // answer): keep watching rather than offer a second charge.
    setReader({ state: "waiting", paymentIntentId, message: "Cancel didn't go through. Wait for the reader, or tap Cancel again.", split });
    watchReaderPayment(paymentIntentId, split);
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
                <button className="btn-quiet" onClick={() => void cancelReaderTip(false)}>
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
                <button className="btn-quiet" onClick={() => void cancelReaderTip(false)}>
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

  if (splitStep === "amount") {
    return (
      <SplitAmount
        due={due}
        initial={splitCash}
        onBack={() => setSplitStep(null)}
        onNext={(cash) => {
          setSplitCash(cash);
          setSplitStep("cash");
        }}
      />
    );
  }

  if (splitStep === "cash") {
    return (
      <CashTender
        total={splitCash}
        then={toCents(due - splitCash)}
        onBack={() => setSplitStep("amount")}
        onDone={(tendered) => {
          setSplitStep(null);
          void handleReaderCharge({ cash: splitCash, tendered });
        }}
      />
    );
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

  if (sending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="card w-full max-w-xs text-center shadow-2xl">
          <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
            Sending to the card reader...
          </h3>
        </div>
      </div>
    );
  }

  if (reader) {
    const { split } = reader;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="card w-full max-w-xs text-center shadow-2xl">
          {reader.state === "waiting" ? (
            <>
              <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
                Present card on reader
              </h3>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {split ? "On the card:" : "Total due:"}{" "}
                <strong className="text-lg" style={{ color: "var(--accent)" }}>
                  {money(cardPart(split))}
                </strong>
              </p>
              {split && (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  Split · {money(split.cash)} in cash{split.tendered > split.cash ? ` · give ${money(toCents(split.tendered - split.cash))} change after` : ""}
                </p>
              )}
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Waiting for the customer to tap, insert, or swipe on the reader...
              </p>
              {reader.message && (
                <p className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                  {reader.message}
                </p>
              )}
              <button className="btn-quiet mt-4" disabled={cancelling} onClick={handleCancelReader}>
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
              {split && (
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  Split: they handed over {money(split.tendered)} for the {money(split.cash)} cash part, and {money(cardPart(split))} still goes on the card. Try the card again, or go back and hand the {money(split.tendered)} back.
                </p>
              )}
              <div className="mt-4 flex justify-center gap-2">
                <button className="btn-secondary" onClick={() => leaveReader(split)}>
                  Back
                </button>
                <button className="btn-primary" onClick={() => handleReaderCharge(split)}>
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
        {splitNote && <p className="notice notice-warn mt-3 !p-2 text-xs">{splitNote}</p>}

        {tabCard && (
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

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button className="btn-secondary min-h-12 px-4 py-2" onClick={() => setCashOpen(true)}>
            Cash
          </button>
          {/* Cards only go through the reader: a "Card" button without one
              recorded a card sale that was never charged. */}
          {readerId && (
            <button className="btn-secondary min-h-12 px-4 py-2" onClick={() => handleReaderCharge()}>
              Card (reader)
            </button>
          )}
          {readerId && SPLIT_ENABLED && due > MIN_CARD && (
            <button
              className="btn-secondary min-h-12 px-4 py-2"
              onClick={() => {
                setSplitNote(null);
                setSplitStep("amount");
              }}
            >
              Split
            </button>
          )}
          {voucher === 0 && (
            <button className="btn-secondary min-h-12 px-4 py-2" onClick={() => setVoucherOpen(true)}>
              Voucher
            </button>
          )}
        </div>
        {!readerId && (
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            Choose this register&apos;s card reader in Devices to take cards.
          </p>
        )}

        <button className="btn-quiet mt-4" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
