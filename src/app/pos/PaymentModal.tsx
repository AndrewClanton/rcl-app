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
                  {money(total)}
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
          Total due:{" "}
          <strong className="text-lg" style={{ color: "var(--accent)" }}>
            {money(total)}
          </strong>
        </p>

        {!splitOpen ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn-secondary px-4 py-2" onClick={() => onConfirm({ method: "cash", cash: total, card: 0 })}>
              Cash
            </button>
            {readerAvailable ? (
              <button className="btn-secondary px-4 py-2" onClick={handleReaderCharge}>
                Card (reader)
              </button>
            ) : (
              <button className="btn-secondary px-4 py-2" onClick={() => onConfirm({ method: "card", cash: 0, card: total })}>
                Card
              </button>
            )}
            <button className="btn-secondary px-4 py-2" onClick={() => setSplitOpen(true)}>
              Split
            </button>
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

        <button className="mt-4 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
