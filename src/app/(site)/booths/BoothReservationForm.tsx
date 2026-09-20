"use client";

import { useMemo, useState, useTransition } from "react";
import type { Booth, BoothReservation } from "@/lib/types";
import { startBoothCheckout, getAvailabilityForDate } from "./actions";

const RESERVATION_HOURS = 2;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function addHours(t: string, hours: number) {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function BoothReservationForm({
  booths,
  initialDate,
  initialReservations,
}: {
  booths: Booth[];
  initialDate: string;
  initialReservations: BoothReservation[];
}) {
  const [date, setDate] = useState(initialDate);
  const [reservations, setReservations] = useState(initialReservations);
  const [loadingAvailability, startAvailabilityTransition] = useTransition();

  const [boothId, setBoothId] = useState(booths[0]?.id ?? "");
  const [startTime, setStartTime] = useState("18:00");
  const [partySize, setPartySize] = useState(2);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBooth = booths.find((b) => b.id === boothId) ?? null;

  const bookedWindowsByBooth = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of reservations) {
      const list = map.get(r.booth_id) ?? [];
      list.push(`${fmtTime(r.start_time)}–${fmtTime(addHours(r.start_time, r.hours))}`);
      map.set(r.booth_id, list);
    }
    return map;
  }, [reservations]);

  function handleDateChange(next: string) {
    setDate(next);
    startAvailabilityTransition(async () => {
      const rows = await getAvailabilityForDate(next);
      setReservations(rows);
    });
  }

  const canSubmit = boothId && date && startTime && partySize > 0 && (selectedBooth ? partySize <= selectedBooth.capacity : false) && name.trim() && email.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await startBoothCheckout({
        boothId,
        reservationDate: date,
        startTime,
        partySize,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <label className="block">
        <div className="label-xs">Date</div>
        <input type="date" className="input" value={date} onChange={(e) => handleDateChange(e.target.value)} />
      </label>

      <div className="mt-4">
        <div className="label-xs mb-2">Booth {loadingAvailability && <span className="text-[var(--muted)]">(checking availability…)</span>}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {booths.map((b) => {
            const booked = bookedWindowsByBooth.get(b.id) ?? [];
            const selected = b.id === boothId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBoothId(b.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{b.label}</span>
                  <span className="text-sm font-semibold text-[var(--accent)]">{money(b.reservation_fee)}</span>
                </div>
                <div className="text-xs text-[var(--muted)]">Seats up to {b.capacity}</div>
                {booked.length > 0 && <div className="mt-1 text-xs text-[var(--muted)]">Booked: {booked.join(", ")}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="label-xs">Start time (2-hour window)</div>
          <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="block">
          <div className="label-xs">Party size {selectedBooth ? `(up to ${selectedBooth.capacity})` : ""}</div>
          <input
            type="number"
            min={1}
            max={selectedBooth?.capacity ?? 12}
            className="input"
            value={partySize}
            onChange={(e) => setPartySize(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <div className="label-xs">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="label-xs">Email</div>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <div className="label-xs">Phone (optional)</div>
          <input type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      {error && <div className="mt-3 text-sm text-[var(--danger-text)]">{error}</div>}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-lg font-semibold">{selectedBooth ? money(selectedBooth.reservation_fee) : "—"}</span>
        <button className="btn-primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? "Redirecting to checkout..." : "Reserve — pay now"}
        </button>
      </div>
      <div className="mt-2 text-xs text-[var(--muted)]">
        You&apos;ll be redirected to Stripe to pay securely. Reservations hold your booth for a {RESERVATION_HOURS}-hour window; the fee covers the reservation only.
      </div>
    </div>
  );
}
