"use client";

import { useMemo, useState, useTransition } from "react";
import type { Booth, BoothReservation } from "@/lib/types";
import { startBoothCheckout, getAvailabilityForDate } from "./actions";
import BoothFloorPlan from "./BoothFloorPlan";

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

function BoothDetailModal({
  booth,
  date,
  onDateChange,
  loadingAvailability,
  bookedWindows,
  onClose,
}: {
  booth: Booth;
  date: string;
  onDateChange: (next: string) => void;
  loadingAvailability: boolean;
  bookedWindows: string[];
  onClose: () => void;
}) {
  const [startTime, setStartTime] = useState("18:00");
  const [partySize, setPartySize] = useState(Math.min(2, booth.capacity));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = date && startTime && partySize > 0 && partySize <= booth.capacity && name.trim() && email.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await startBoothCheckout({
        boothId: booth.id,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel w-full max-w-md bg-[var(--surface)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Reserve</div>
            <h2 className="font-display text-xl leading-tight">{booth.label}</h2>
            <div className="text-xs text-[var(--muted)]">Seats up to {booth.capacity}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            ✕
          </button>
        </div>

        <label className="mt-4 block">
          <div className="label-xs">Day {loadingAvailability && <span>(checking availability…)</span>}</div>
          <input type="date" className="input" value={date} onChange={(e) => onDateChange(e.target.value)} />
        </label>

        {bookedWindows.length > 0 && (
          <div className="notice notice-warn mt-2">Already booked that day: {bookedWindows.join(", ")}</div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="label-xs">Start time (2-hour window)</div>
            <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="block">
            <div className="label-xs">Party size (up to {booth.capacity})</div>
            <input
              type="number"
              min={1}
              max={booth.capacity}
              className="input"
              value={partySize}
              onChange={(e) => setPartySize(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="label-xs">Name</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <div className="label-xs">Email</div>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <div className="label-xs">Phone (optional)</div>
            <input type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>

        {error && <div className="mt-3 text-sm text-[var(--danger-text)]">{error}</div>}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-lg font-semibold text-[var(--accent)]">{money(booth.reservation_fee)}</span>
          <button className="btn-primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "Redirecting to checkout..." : "Reserve — pay now"}
          </button>
        </div>
        <div className="mt-2 text-xs text-[var(--muted)]">
          You&apos;ll be redirected to Stripe to pay securely. Reservations hold your booth for a {RESERVATION_HOURS}-hour window; the fee covers the reservation only.
        </div>
      </div>
    </div>
  );
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
  const [boothId, setBoothId] = useState<string | null>(null);

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

  const bookedIds = useMemo(() => new Set(reservations.map((r) => r.booth_id)), [reservations]);

  function handleDateChange(next: string) {
    setDate(next);
    startAvailabilityTransition(async () => {
      const rows = await getAvailabilityForDate(next);
      setReservations(rows);
    });
  }

  return (
    <div>
      <BoothFloorPlan booths={booths} selectedId={boothId} bookedIds={bookedIds} onSelect={setBoothId} />

      {selectedBooth && (
        <BoothDetailModal
          booth={selectedBooth}
          date={date}
          onDateChange={handleDateChange}
          loadingAvailability={loadingAvailability}
          bookedWindows={bookedWindowsByBooth.get(selectedBooth.id) ?? []}
          onClose={() => setBoothId(null)}
        />
      )}
    </div>
  );
}
