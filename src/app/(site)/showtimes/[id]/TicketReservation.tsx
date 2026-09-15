"use client";

import { useState } from "react";
import { startCheckout } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function TicketReservation({ screeningId, ticketPrice, seatsLeft }: { screeningId: string; ticketPrice: number; seatsLeft: number }) {
  const [quantity, setQuantity] = useState(seatsLeft > 0 ? 1 : 0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = quantity > 0 && quantity <= seatsLeft && name.trim() && email.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await startCheckout({ screeningId, quantity, customerName: name, customerEmail: email });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (seatsLeft <= 0) {
    return (
      <div className="rounded-xl border border-neutral-200 p-6 text-center dark:border-neutral-800">
        <div className="font-medium">Sold out</div>
        <div className="mt-1 text-sm text-neutral-500">This screening is at capacity.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-neutral-500">{seatsLeft} seat(s) left</span>
        <div className="flex items-center gap-3">
          <button className="h-8 w-8 rounded border border-neutral-300 dark:border-neutral-700" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
            −
          </button>
          <span className="min-w-[1.5rem] text-center font-medium">{quantity}</span>
          <button
            className="h-8 w-8 rounded border border-neutral-300 dark:border-neutral-700"
            disabled={quantity >= seatsLeft}
            onClick={() => setQuantity((q) => q + 1)}
          >
            +
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs text-neutral-500">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-neutral-500">Email</div>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-lg font-semibold">{money(ticketPrice * quantity)}</span>
        <button
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
        >
          {submitting ? "Redirecting to checkout..." : "Buy tickets — pay now"}
        </button>
      </div>
      <div className="mt-2 text-xs text-neutral-500">You&apos;ll be redirected to Stripe to pay securely. Your seats are held for 30 minutes.</div>
    </div>
  );
}
