"use client";

import { useState } from "react";
import { reserveTickets } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function TicketReservation({ screeningId, ticketPrice, seatsLeft }: { screeningId: string; ticketPrice: number; seatsLeft: number }) {
  const [quantity, setQuantity] = useState(seatsLeft > 0 ? 1 : 0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = quantity > 0 && quantity <= seatsLeft && name.trim() && email.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await reserveTickets({ screeningId, quantity, customerName: name, customerEmail: email });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">Seats reserved!</h2>
        <p className="mt-2 text-sm text-green-800 dark:text-green-400">
          {quantity} ticket{quantity === 1 ? "" : "s"} held under {name}. Online payment isn&apos;t live yet — pay at the door when you arrive, or call ahead.
        </p>
      </div>
    );
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
          {submitting ? "Reserving..." : "Reserve — pay at the door"}
        </button>
      </div>
      <div className="mt-2 text-xs text-neutral-500">Online payment is coming soon. This holds your seats without charging you now.</div>
    </div>
  );
}
