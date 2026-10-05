"use client";

import { useState } from "react";
import type { Room } from "@/lib/types";
import { estimateEventTotal } from "@/lib/eventPricing";
import { submitEventInquiry } from "./actions";
import { SpecFoot } from "@/components/print";
import { CLOSED_DAYS_NOTE, isClosedDate } from "@/lib/closed-days";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// A booking request in four short steps, with the running estimate beside
// it (below it on a phone) -- rather than one long column of fields.
export default function EventBookingForm({ rooms }: { rooms: Room[] }) {
  const [roomId, setRoomId] = useState("");
  const [hours, setHours] = useState(2);
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
  const estimate = room ? estimateEventTotal(room, hours, addonIds) : 0;
  const overCapacity = room && guests && parseInt(guests, 10) > room.capacity;

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // A native date picker can't grey out a closed day, so it's flagged and
  // the button says why; the server refuses it too.
  const closed = isClosedDate(eventDate);
  const missing = !room ? "Pick a space" : !eventDate || !eventTime ? "Pick a date and time" : closed ? CLOSED_DAYS_NOTE : !organizerEmail.includes("@") ? "Add your email" : null;
  const canSubmit = !missing && hours > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const inquiryResult = await submitEventInquiry({
        roomId,
        hours,
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
      if (!inquiryResult.ok) {
        setError(inquiryResult.error);
        return;
      }
      setResult(inquiryResult.estimate);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <div className="sheet p-5">
        <span className="ctag ctag-yellow">Request sent</span>
        <h2 className="font-display mt-3 text-2xl">We&apos;ll be in touch.</h2>
        <p className="mt-2 text-[15px]">
          Estimated total {money(result)}, plus Missouri sales tax. We&apos;ll email {organizerEmail} to confirm the details and arrange your deposit.
        </p>
      </div>
    );
  }

  const addons = room ? room.addons.filter((a) => addonIds.includes(a.id)) : [];

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
      <div className="space-y-9">
        <Step n={1} title="Pick a space">
          <div role="radiogroup" aria-label="Space" className="grid gap-4 sm:grid-cols-2">
            {rooms.map((r) => {
              const on = roomId === r.id;
              return (
                <button
                  key={r.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setRoomId(r.id);
                    setAddonIds([]);
                  }}
                  className={`overflow-hidden rounded-[4px] border-2 border-[var(--foreground)] text-left transition-transform ${on ? "shadow-[4px_4px_0_var(--foreground)]" : "hover:-translate-y-px"}`}
                >
                  <div className={`font-display px-4 py-3 text-[15px] leading-tight ${on ? "bg-[var(--gold)]" : "bg-[var(--surface)]"}`}>{r.name}</div>
                  <div className="grid grid-cols-3 border-t-2 border-[var(--foreground)] bg-[var(--surface)]">
                    <Mini k="Per hour" v={money(r.hourly_rate ?? 0)} />
                    <Mini k="Guests" v={`Up to ${r.capacity}`} />
                    <Mini k="Cleaning" v={money(r.cleaning_fee ?? 0)} last />
                  </div>
                </button>
              );
            })}
          </div>
          {room && room.addons.length > 0 && (
            <div className="mt-5">
              <div className="label-xs">Add-ons (optional)</div>
              <div className="flex flex-wrap gap-2">
                {room.addons.map((a) => (
                  <button key={a.id} className={`chip ${addonIds.includes(a.id) ? "chip-selected" : ""}`} onClick={() => toggleAddon(a.id)}>
                    {a.name} · +{money(a.hourly_rate)}/hr
                  </button>
                ))}
              </div>
            </div>
          )}
        </Step>

        <Step n={2} title="When">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date">
              <input type="date" className="input" value={eventDate} aria-invalid={closed || undefined} onChange={(e) => setEventDate(e.target.value)} />
            </Field>
            <Field label="Start time">
              <input type="time" className="input" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
            </Field>
            <div>
              <div className="label-xs">How long</div>
              <div className="flex items-center gap-3">
                <button type="button" className="btn-secondary h-11 w-11 !p-0 text-xl" aria-label="Half an hour less" disabled={hours <= 1} onClick={() => setHours((h) => Math.max(1, h - 0.5))}>
                  −
                </button>
                <span className="font-display min-w-[4.5ch] text-center text-xl tabular-nums" aria-live="polite">
                  {hours} hr
                </span>
                <button type="button" className="btn-secondary h-11 w-11 !p-0 text-xl" aria-label="Half an hour more" disabled={hours >= 12} onClick={() => setHours((h) => Math.min(12, h + 0.5))}>
                  +
                </button>
              </div>
            </div>
          </div>
          {closed ? (
            <p role="alert" className="mt-2 text-sm font-bold text-[var(--danger-text)]">
              {CLOSED_DAYS_NOTE} Pick another day.
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--muted)]">{CLOSED_DAYS_NOTE}</p>
          )}
        </Step>

        <Step n={3} title="The event">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Event name (optional)">
              <input className="input" placeholder="Smith birthday party" value={eventName} onChange={(e) => setEventName(e.target.value)} />
            </Field>
            <Field label="Expected guests">
              <input type="number" inputMode="numeric" min="0" step="1" className="input" value={guests} onChange={(e) => setGuests(e.target.value)} />
              {overCapacity && <div className="mt-1 text-sm font-bold text-[var(--danger-text)]">That&apos;s over capacity for {room?.name} (up to {room?.capacity}).</div>}
            </Field>
            <Field label="Movie to screen (optional)">
              <input className="input" placeholder="A title, or leave it to us" value={movieTitle} onChange={(e) => setMovieTitle(e.target.value)} />
            </Field>
            <Field label="Pizzas (optional)">
              <input type="number" inputMode="numeric" min="0" step="1" className="input" value={pizzas} onChange={(e) => setPizzas(e.target.value)} />
            </Field>
          </div>
        </Step>

        <Step n={4} title="About you">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <input className="input" autoComplete="name" value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} />
            </Field>
            <Field label="Your email">
              <input type="email" className="input" autoComplete="email" placeholder="name@example.com" value={organizerEmail} onChange={(e) => setOrganizerEmail(e.target.value)} />
            </Field>
          </div>
        </Step>
      </div>

      {/* The running estimate, set like a spec panel. */}
      <aside className="sheet crop lg:sticky lg:top-40">
        <h2 className="spec-head rounded-t-[4px]">
          <span>Your estimate</span>
        </h2>
        <dl className="space-y-2 px-4 py-4 text-[15px]">
          <Row k="Space" v={room ? room.name : "Not picked yet"} />
          <Row k={`${hours} hr${hours === 1 ? "" : "s"}`} v={room ? money((room.hourly_rate ?? 0) * hours) : "—"} />
          {addons.map((a) => (
            <Row key={a.id} k={a.name} v={money(a.hourly_rate * hours)} />
          ))}
          <Row k="Cleaning (once)" v={room ? money(room.cleaning_fee ?? 0) : "—"} />
        </dl>
        <div className="border-t-2 border-dashed border-[var(--border)] px-4 py-4">
          <div className="label-xs !mb-0.5">Estimated total</div>
          <div className="font-display text-3xl leading-none tabular-nums">{money(estimate)}</div>
          <div className="mt-1 text-sm font-bold">plus Missouri sales tax</div>
          <p className="mt-2 text-sm text-[var(--muted)]">Nothing is charged now. We&apos;ll confirm the details and arrange a deposit by email.</p>
          {error && <div className="mt-3 text-sm font-bold text-[var(--danger-text)]">{error}</div>}
          <button className="btn-primary mt-4 w-full px-5 py-3 text-base" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? "Sending…" : missing ?? "Send my request"}
          </button>
        </div>
        <SpecFoot />
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display mb-4 flex items-center gap-3 text-2xl">
        <span aria-hidden="true" className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[4px] bg-[var(--foreground)] text-base text-[var(--gold)]">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Mini({ k, v, last = false }: { k: string; v: string; last?: boolean }) {
  return (
    <div className={`px-3 py-2 ${last ? "" : "border-r border-[var(--border)]"}`}>
      <div className="spec-k !text-[9.5px]">{k}</div>
      <div className="font-display text-sm">{v}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="text-right font-bold">{v}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="label-xs">{label}</div>
      {children}
    </label>
  );
}
