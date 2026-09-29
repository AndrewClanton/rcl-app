"use client";

import { useState } from "react";
import PlusLink from "@/components/PlusLink";
import { salesTaxOn } from "@/lib/sales-tax";
import { startCheckout } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// `me` is the signed-in member, if any: their name and email are already
// on file, so they aren't asked for again.
export default function TicketReservation({
  screeningId,
  ticketPrice,
  seatsLeft,
  me = null,
  plusPrice,
}: {
  screeningId: string;
  ticketPrice: number;
  seatsLeft: number;
  me?: { name: string; email: string; plus: boolean; freeSeat: boolean } | null;
  plusPrice: number;
}) {
  const [quantity, setQuantity] = useState(seatsLeft > 0 ? 1 : 0);
  const [editing, setEditing] = useState(!me);
  const [name, setName] = useState(me?.name ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  // Insiders+ covers the member's own seat (once per screening); guests
  // they bring still pay.
  const freeSeats = me?.freeSeat && !editing ? Math.min(1, quantity) : 0;
  const due = ticketPrice * (quantity - freeSeats);
  // Missouri sales tax, added at checkout (shown here so the total matches).
  const tax = salesTaxOn(due);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = quantity > 0 && quantity <= seatsLeft && name.trim() && email.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await startCheckout({ screeningId, quantity, customerName: name, customerEmail: email });
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      window.location.href = result.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (seatsLeft <= 0) {
    return (
      <div className="card text-center">
        <div className="font-medium">Sold out</div>
        <div className="mt-1 text-sm text-[var(--muted)]">This screening is at capacity.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-[var(--muted)]">{seatsLeft} seat(s) left</span>
        <div className="flex items-center gap-3">
          <button className="btn-secondary h-8 w-8 !p-0 text-center" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
            −
          </button>
          <span className="min-w-[1.5rem] text-center font-medium">{quantity}</span>
          <button className="btn-secondary h-8 w-8 !p-0 text-center" disabled={quantity >= seatsLeft} onClick={() => setQuantity((q) => q + 1)}>
            +
          </button>
        </div>
      </div>

      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="label-xs">Name</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <div className="label-xs">Email</div>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Booking as <strong>{name}</strong> <span className="text-[var(--muted)]">· {email}</span>
            {me?.freeSeat ? (
              <span className="ml-2 font-bold text-[var(--accent)]">Insiders+ · your ticket is free</span>
            ) : (
              me?.plus && <span className="ml-2 text-xs text-[var(--muted)]">Insiders+ · your free seat for this show is already booked</span>
            )}
          </span>
          <button className="text-xs text-[var(--muted)] underline" onClick={() => setEditing(true)}>
            Booking for someone else?
          </button>
        </div>
      )}

      {error && <div className="mt-3 text-sm text-[var(--danger-text)]">{error}</div>}

      <div className="mt-4 flex items-center justify-between">
        <span>
          <span className="text-lg font-semibold">{money(due + tax)}</span>
          {tax > 0 && <span className="ml-1.5 text-xs text-[var(--muted)]">includes {money(tax)} tax</span>}
        </span>
        <button className="btn-primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? "One moment..." : due === 0 ? "Reserve my seat" : "Buy tickets — pay now"}
        </button>
      </div>
      {due > 0 && <div className="mt-2 text-xs text-[var(--muted)]">You&apos;ll be redirected to Stripe to pay securely. Your seats are held for 30 minutes.</div>}

      {!me?.plus && ticketPrice > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--accent)] px-4 py-3 text-sm">
          <span>
            <strong>Skip the ticket.</strong> Insiders+ members walk in free to every screening, ${plusPrice}/month.
          </span>
          <PlusLink next={`/showtimes/${screeningId}`} className="btn-primary !py-1.5 text-sm">
            Get Insiders+
          </PlusLink>
        </div>
      )}
    </div>
  );
}
