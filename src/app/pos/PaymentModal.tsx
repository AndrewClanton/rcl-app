"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutPayment } from "./actions";
import { startReaderPayment, checkReaderPayment, cancelReaderPayment } from "./terminal-actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

type ReaderState = "waiting" | "failed";

export default function PaymentModal({
  total,
  readerAvailable,
  onConfirm,
  onCancel,
}: {
  total: number;
  readerAvailable: boolean;
  onConfirm: (payment: CheckoutPayment) => void;
  onCancel: () => void;
}) {
  const [splitOpen, setSplitOpen] = useState(false);
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [error, setError] = useState(false);
  const [reader, setReader] = useState<{ state: ReaderState; paymentIntentId: string; message?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleReaderCharge() {
    setReader(null);
    try {
      const { paymentIntentId } = await startReaderPayment(Math.round(total * 100));
      setReader({ state: "waiting", paymentIntentId });
      pollRef.current = setInterval(async () => {
        try {
          const { status, errorMessage } = await checkReaderPayment(paymentIntentId);
          if (status === "succeeded") {
            if (pollRef.current) clearInterval(pollRef.current);
            onConfirm({ method: "card", cash: 0, card: total, stripePaymentIntentId: paymentIntentId });
          } else if (status === "canceled") {
            if (pollRef.current) clearInterval(pollRef.current);
            setReader({ state: "failed", paymentIntentId, message: errorMessage ?? "Payment was canceled." });
          } else if (errorMessage) {
            // requires_payment_method after a decline -- reader auto-prompts retry, but surface the message.
            setReader({ state: "waiting", paymentIntentId, message: errorMessage });
          }
        } catch {
          // transient poll failure -- keep waiting, next tick retries
        }
      }, 1500);
    } catch (e) {
      setReader({ state: "failed", paymentIntentId: "", message: e instanceof Error ? e.message : "Could not reach the card reader." });
    }
  }

  async function handleCancelReader() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (reader?.paymentIntentId) await cancelReaderPayment(reader.paymentIntentId).catch(() => {});
    setReader(null);
  }

  if (reader) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
          {reader.state === "waiting" ? (
            <>
              <h3 className="text-lg font-semibold">Present card on reader</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Total due: <strong className="text-neutral-900 dark:text-neutral-100">{money(total)}</strong>
              </p>
              <p className="mt-3 text-sm text-neutral-500">Waiting for the customer to tap, insert, or swipe on the reader...</p>
              {reader.message && <p className="mt-2 text-xs text-red-600">{reader.message}</p>}
              <button className="mt-4 text-sm text-neutral-500 hover:underline" onClick={handleCancelReader}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold">Card reader error</h3>
              <p className="mt-2 text-sm text-red-600">{reader.message}</p>
              <div className="mt-4 flex justify-center gap-2">
                <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={() => setReader(null)}>
                  Back
                </button>
                <button
                  className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
                  onClick={handleReaderCharge}
                >
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">Take payment</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Total due: <strong className="text-neutral-900 dark:text-neutral-100">{money(total)}</strong>
        </p>

        {!splitOpen ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
              onClick={() => onConfirm({ method: "cash", cash: total, card: 0 })}
            >
              Cash
            </button>
            {readerAvailable ? (
              <button className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700" onClick={handleReaderCharge}>
                Card (reader)
              </button>
            ) : (
              <button
                className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
                onClick={() => onConfirm({ method: "card", cash: 0, card: total })}
              >
                Card
              </button>
            )}
            <button className="rounded border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700" onClick={() => setSplitOpen(true)}>
              Split
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2 text-left">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Cash amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Card amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={card}
                onChange={(e) => setCard(e.target.value)}
              />
            </div>
            {error && <div className="text-xs text-red-600">Cash + card must equal the total due.</div>}
            <button
              className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
              onClick={() => {
                const c = parseFloat(cash) || 0;
                const cd = parseFloat(card) || 0;
                if (Math.abs(c + cd - total) > 0.01) {
                  setError(true);
                  return;
                }
                onConfirm({ method: "split", cash: c, card: cd });
              }}
            >
              Confirm split
            </button>
          </div>
        )}

        <button className="mt-4 text-sm text-neutral-500 hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
