"use client";

import { useMemo, useState } from "react";
import type { Room } from "@/lib/types";
import { estimateEventTotal } from "@/lib/eventPricing";
import { submitEventInquiry } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function EventBookingForm({ rooms }: { rooms: Room[] }) {
  const [roomId, setRoomId] = useState("");
  const [hours, setHours] = useState("2");
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventName, setEventName] = useState("");
  const [movieTitle, setMovieTitle] = useState("");
  const [guests, setGuests] = useState("");
  const [pizzas, setPizzas] = useState("");
  const [organizerName, setOrganizerName] = useState("");
  const [organizerEmail, setOrganizerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const hoursNum = parseFloat(hours) || 0;
  const estimate = room ? estimateEventTotal(room, hoursNum, addonIds) : 0;
  const overCapacity = room && guests && parseInt(guests, 10) > room.capacity;

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canSubmit = room && hoursNum > 0 && eventDate && eventTime && organizerEmail.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { estimate: est } = await submitEventInquiry({
        roomId,
        hours: hoursNum,
        addonIds,
        eventDate,
        eventTime,
        eventName,
        movieTitle,
        guestCount: guests ? parseInt(guests, 10) : null,
        pizzaCount: pizzas ? parseInt(pizzas, 10) : null,
        organizerName,
        organizerEmail,
      });
      setResult(est);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">Request sent!</h2>
        <p className="mt-2 text-sm text-green-800 dark:text-green-400">
          Estimated total: {money(result)}. We&apos;ll follow up by email at {organizerEmail} to confirm details and arrange your deposit.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-4 text-lg font-semibold">Request a booking</h2>

      <div className="mb-4">
        <div className="mb-1 text-xs text-neutral-500">Space</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {rooms.map((r) => (
            <button
              key={r.id}
              className={`rounded-lg border p-3 text-left text-sm ${
                roomId === r.id ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-200 dark:border-neutral-800"
              }`}
              onClick={() => {
                setRoomId(r.id);
                setAddonIds([]);
              }}
            >
              <div className="font-medium">{r.name}</div>
              <div className="text-neutral-500">
                {money(r.hourly_rate ?? 0)}/hr · capacity {r.capacity}
              </div>
            </button>
          ))}
        </div>
      </div>

      {room && (
        <>
          <div className="mb-2 text-xs text-neutral-500">
            Cleaning fee {money(room.cleaning_fee ?? 0)} added once, regardless of hours.
          </div>

          {room.addons.length > 0 && (
            <div className="mb-4">
              <div className="mb-1 text-xs text-neutral-500">Add-ons (optional)</div>
              <div className="flex flex-wrap gap-2">
                {room.addons.map((a) => (
                  <button
                    key={a.id}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      addonIds.includes(a.id) ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700"
                    }`}
                    onClick={() => toggleAddon(a.id)}
                  >
                    {a.name} (+{money(a.hourly_rate)}/hr)
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hours booked">
          <input type="number" min="1" step="0.5" className="input" value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Expected guests">
          <input type="number" min="0" step="1" className="input" value={guests} onChange={(e) => setGuests(e.target.value)} />
          {overCapacity && <div className="mt-1 text-xs text-red-600">Over capacity for {room?.name} (max {room?.capacity}).</div>}
        </Field>
        <Field label="Event date">
          <input type="date" className="input" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </Field>
        <Field label="Event time">
          <input type="time" className="input" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
        </Field>
        <Field label="Movie to screen (optional)">
          <input className="input" value={movieTitle} onChange={(e) => setMovieTitle(e.target.value)} />
        </Field>
        <Field label="Pizzas needed (optional)">
          <input type="number" min="0" step="1" className="input" value={pizzas} onChange={(e) => setPizzas(e.target.value)} />
        </Field>
        <Field label="Event name (optional)">
          <input className="input" placeholder="e.g. Smith birthday party" value={eventName} onChange={(e) => setEventName(e.target.value)} />
        </Field>
        <Field label="Your name">
          <input className="input" value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} />
        </Field>
        <Field label="Your email">
          <input className="input" placeholder="name@example.com" value={organizerEmail} onChange={(e) => setOrganizerEmail(e.target.value)} />
        </Field>
      </div>

      {room && (
        <div className="mt-4 rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
          Estimated total: <strong>{money(estimate)}</strong>
          <div className="text-xs text-neutral-500">A deposit will be arranged with staff to confirm the booking.</div>
        </div>
      )}

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      <button
        className="mt-4 w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        disabled={!canSubmit || submitting}
        onClick={handleSubmit}
      >
        {submitting ? "Sending..." : "Request this booking"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-neutral-500">{label}</div>
      {children}
    </label>
  );
}
