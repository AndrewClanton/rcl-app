"use client";

import { useState } from "react";
import PlusLink from "@/components/PlusLink";
import Honeypot from "@/components/Honeypot";
import { salesTaxOn } from "@/lib/sales-tax";
import { startCheckout } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// `me` is the signed-in member, if any: their name and email are already
// on file, so they aren't asked for again. `formToken` (stamped when the
// page was built) and the hidden field go back with the order, for the bot
// check on free seats (lib/public-form-guard.ts).
export default function TicketReservation({
  screeningId,
  ticketPrice,
  seatsLeft,
  me = null,
  plusPrice,
  formToken,
}: {
  screeningId: string;
  ticketPrice: number;
  seatsLeft: number;
  me?: { name: string; email: string; plus: boolean; freeSeat: boolean } | null;
  plusPrice: number;
  formToken: string;
}) {
  const [honeypot, setHoneypot] = useState("");
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
      const result = await startCheckout({ screeningId, quantity, customerName: name, customerEmail: email, formToken, honeypot });
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
      <div className="sheet p-5">
        <span className="ctag ctag-red">Sold out</span>
        <h2 className="font-display mt-3 text-2xl">This show is full.</h2>
        <p className="mt-2 text-[15px]">Check the other showtimes, or ask at the box office about a cancellation.</p>
      </div>
    );
  }

  const maxQty = Math.min(seatsLeft, 10);

  return (
    <section className="sheet crop">
      <div className="spec-head rounded-t-[4px]">
        <span>Get tickets</span>
        <span className="flex items-center gap-4">
          <span>{seatsLeft} seats left</span>
        </span>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="label-xs !mb-0.5">How many</div>
            <div className="text-sm text-[var(--muted)]">{ticketPrice === 0 ? "Free screening" : `${money(ticketPrice)} each, plus tax`}</div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-secondary h-11 w-11 !p-0 text-center text-xl" aria-label="One fewer ticket" disabled={quantity <= 1} onClick={() => setQuantity((q) => q - 1)}>
              −
            </button>
            <span className="font-display min-w-[2ch] text-center text-3xl tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <button className="btn-secondary h-11 w-11 !p-0 text-center text-xl" aria-label="One more ticket" disabled={quantity >= maxQty} onClick={() => setQuantity((q) => q + 1)}>
              +
            </button>
          </div>
        </div>

      {editing ? (
        <div className="grid gap-4 sm:grid-cols-2">
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

      <Honeypot value={honeypot} onChange={setHoneypot} />

      {error && <div className="text-sm font-bold text-[var(--danger-text)]">{error}</div>}

      <div className="flex flex-wrap items-end justify-between gap-4 border-t-2 border-dashed border-[var(--border)] pt-4">
        <div>
          <div className="label-xs !mb-0.5">Total</div>
          <div className="font-display text-3xl leading-none tabular-nums">{money(due + tax)}</div>
          {tax > 0 && <div className="mt-1 text-xs text-[var(--muted)]">Includes {money(tax)} Missouri sales tax</div>}
        </div>
        <button className="btn-primary w-full px-6 py-3 text-base sm:w-auto" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? "One moment…" : !canSubmit && editing ? "Add your name and email" : due === 0 ? "Reserve my seat" : "Buy tickets"}
        </button>
      </div>
      {due > 0 && <div className="text-xs text-[var(--muted)]">Pay securely with Stripe on the next page. Your seats are held for 30 minutes.</div>}
      </div>

      {!me?.plus && ticketPrice > 0 && (
        <div className="halftone halftone-hero flex flex-wrap items-center justify-between gap-3 rounded-b-[4px] border-t-2 border-[var(--foreground)] bg-[var(--gold)] px-4 py-4 sm:px-5">
          <span className="relative z-[1] max-w-[42ch] text-[15px]">
            <strong className="font-display">Skip the ticket.</strong> Insiders+ members walk in free to every screening, ${plusPrice}/month.
          </span>
          <PlusLink next={`/showtimes/${screeningId}`} className="btn-primary relative z-[1] px-4 py-2 text-sm">
            Get Insiders+
          </PlusLink>
        </div>
      )}
    </section>
  );
}
