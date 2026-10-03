"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import type { Booth } from "@/lib/types";
import type { BoothBusy } from "@/lib/data/booths";
import { startBoothCheckout, getAvailabilityForDate } from "./actions";
import BoothPhotoGrid from "./BoothPhotoGrid";
import PlusLink from "@/components/PlusLink";
import Honeypot from "@/components/Honeypot";
import { CLOSED_DAYS_NOTE, isClosedDate } from "@/lib/closed-days";
import { salesTaxOn } from "@/lib/sales-tax";

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

// The booth pop-up, set as a proof-sheet spec panel: an ink header bar with
// the booth's name, its hard facts in a grid, then three short groups
// (when, how many, who) and the button. On a phone it runs full width and
// the backdrop scrolls, so nothing is cut off on a short screen.
function BoothDetailModal({
  booth,
  date,
  minDate,
  onDateChange,
  loadingAvailability,
  bookedWindows,
  onClose,
  me,
  formToken,
}: {
  booth: Booth;
  date: string;
  minDate: string;
  onDateChange: (next: string) => void;
  loadingAvailability: boolean;
  bookedWindows: string[];
  onClose: () => void;
  me: BoothMe | null;
  formToken: string;
}) {
  const [honeypot, setHoneypot] = useState("");
  const [startTime, setStartTime] = useState("18:00");
  const [partySize, setPartySize] = useState(Math.min(2, booth.capacity));
  // A signed-in member's details are already on file: not asked again.
  const [editing, setEditing] = useState(!me);
  const [name, setName] = useState(me?.name ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  // A closed day can't be greyed out in a native date picker, so it's
  // flagged and the button stays off; the server refuses it too.
  const closed = isClosedDate(date);
  const canSubmit = date && !closed && startTime && partySize > 0 && partySize <= booth.capacity && name.trim() && email.includes("@");
  const holdWindow = /^\d{1,2}:\d{2}/.test(startTime) ? `${fmtTime(startTime)} – ${fmtTime(addHours(startTime, RESERVATION_HOURS))}` : null;

  // Escape closes it; the page behind stays put while it's open; keyboard
  // focus starts inside the pop-up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = before;
    };
  }, []);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await startBoothCheckout({
        boothId: booth.id,
        reservationDate: date,
        startTime,
        partySize,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        formToken,
        honeypot,
      });
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[rgba(20,17,12,0.72)]"
      onClick={onClose}
    >
      <div className="flex min-h-full items-start justify-center px-3 py-5 sm:items-center sm:p-8">
        <div ref={sheetRef} tabIndex={-1} className="sheet w-full max-w-lg outline-none" onClick={(e) => e.stopPropagation()}>
          <header className="spec-head !items-start rounded-t-[4px] !py-3 !pr-3">
            <div className="min-w-0 pt-0.5">
              <div className="font-mono text-[10.5px] font-bold tracking-[0.14em] text-[rgba(248,245,236,0.72)]">Reserve</div>
              <h2 id={titleId} className="mt-1 text-lg leading-tight [overflow-wrap:anywhere] sm:text-xl">
                {booth.label}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-[4px] border-2 border-[var(--gold)] text-base text-[var(--gold)] transition-colors hover:bg-[var(--gold)] hover:text-[var(--foreground)]"
            >
              ✕
            </button>
          </header>

          <dl className="spec-grid spec-grid-3 border-b-2 border-[var(--foreground)]">
            <div className="spec-cell !px-3 sm:!px-4">
              <dt className="spec-k">Seats up to</dt>
              <dd className="spec-v">{booth.capacity}</dd>
            </div>
            <div className="spec-cell !px-3 sm:!px-4">
              <dt className="spec-k">Window</dt>
              <dd className="spec-v">{RESERVATION_HOURS} hours</dd>
            </div>
            <div className="spec-cell !px-3 sm:!px-4">
              <dt className="spec-k">Fee</dt>
              <dd className="spec-v text-[var(--accent)]">{money(booth.reservation_fee)}</dd>
            </div>
          </dl>

          <div className="space-y-6 px-4 py-5 sm:px-5">
            <fieldset>
              <Legend n={1}>When</Legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="label-xs">Day</div>
                  <input type="date" className="input" min={minDate} value={date} aria-invalid={closed || undefined} onChange={(e) => onDateChange(e.target.value)} />
                </label>
                <label className="block">
                  <div className="label-xs">Start time (2-hour window)</div>
                  <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
              </div>
              {closed && (
                <p role="alert" className="mt-2 text-sm font-bold text-[var(--danger-text)]">
                  {CLOSED_DAYS_NOTE} Pick another day.
                </p>
              )}
              {holdWindow && !closed && (
                <p className="mt-2 text-[15px]">
                  Holds the booth <strong className="whitespace-nowrap">{holdWindow}</strong>.
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--muted)]">
                {CLOSED_DAYS_NOTE} Booths open up starting tomorrow, so no one books a seat out from under whoever&apos;s already sitting in it.
              </p>

              {loadingAvailability ? (
                <div role="status" className="spec-k mt-3 !mb-0">
                  Checking availability…
                </div>
              ) : (
                bookedWindows.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-[4px] border-2 border-[var(--foreground)]">
                    <div className="spec-k !mb-0 border-b border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2 !text-[var(--foreground)]">Already booked that day</div>
                    <ul className="divide-y divide-[var(--border)]">
                      {bookedWindows.map((w, i) => (
                        <li key={`${w}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="font-display text-sm tabular-nums">{w}</span>
                          <span className="spec-k !mb-0 !text-[var(--accent)]">Taken</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </fieldset>

            <fieldset>
              <Legend n={2}>Party size</Legend>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="btn-secondary h-11 w-11 !p-0 text-xl"
                    aria-label="One fewer guest"
                    disabled={partySize <= 1}
                    onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                  >
                    −
                  </button>
                  <output aria-live="polite" aria-label="Party size" className="font-display min-w-[2.5ch] text-center text-3xl leading-none tabular-nums">
                    {partySize}
                  </output>
                  <button
                    type="button"
                    className="btn-secondary h-11 w-11 !p-0 text-xl"
                    aria-label="One more guest"
                    disabled={partySize >= booth.capacity}
                    onClick={() => setPartySize((n) => Math.min(booth.capacity, n + 1))}
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-[var(--muted)]">
                  {partySize >= booth.capacity ? `That's the most this booth seats.` : `This booth seats up to ${booth.capacity}.`}
                </span>
              </div>
            </fieldset>

            <fieldset>
              <Legend n={3}>Who it&apos;s for</Legend>
              {editing ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="label-xs">Name</div>
                    <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="block">
                    <div className="label-xs">Email</div>
                    <input type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label className="block sm:col-span-2">
                    <div className="label-xs">Phone (optional)</div>
                    <input type="tel" className="input" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </label>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[4px] border-2 border-[var(--foreground)] px-3 py-2.5 text-[15px]">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    Reserving as <strong>{name}</strong> <span className="text-[var(--muted)]">· {email}</span>
                  </span>
                  <button type="button" className="text-sm font-bold underline decoration-2 underline-offset-2 hover:text-[var(--accent)]" onClick={() => setEditing(true)}>
                    For someone else?
                  </button>
                </div>
              )}
            </fieldset>

            <div className="rounded-[4px] border-2 border-[var(--foreground)] bg-[var(--gold)] px-3 py-3 text-sm">
              <span className="ctag ctag-red mr-2 !px-2 !py-0.5 !text-[10.5px]">Insiders+ perk</span>
              <strong>2 free booth reservations every month.</strong>{" "}
              {me?.plus ? (
                editing ? (
                  "Free reservations cover booths booked under your own name and email."
                ) : (
                  "We'll apply one automatically if you have one left this month."
                )
              ) : (
                <>
                  <PlusLink next="/booths" className="font-bold underline decoration-2 underline-offset-2">
                    Get Insiders+
                  </PlusLink>{" "}
                  and this one could be free.
                </>
              )}
            </div>
          </div>

          <div className="border-t-2 border-dashed border-[var(--border)] px-4 py-4 sm:px-5">
            <Honeypot value={honeypot} onChange={setHoneypot} />
            {error && (
              <div role="alert" className="mb-3 text-sm font-bold text-[var(--danger-text)]">
                {error}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="label-xs !mb-0.5">Reservation fee</div>
                <div className="font-display text-3xl leading-none tabular-nums">{money(booth.reservation_fee)}</div>
                {/* Stripe adds Missouri sales tax on top (startBoothCheckout). */}
                {booth.reservation_fee > 0 && <div className="mt-1 text-xs text-[var(--muted)]">plus {money(salesTaxOn(booth.reservation_fee))} Missouri sales tax</div>}
              </div>
              <button className="btn-primary px-6 py-3 text-base max-sm:w-full" disabled={!canSubmit || submitting} onClick={handleSubmit}>
                {submitting ? "Just a moment..." : "Reserve this booth"}
              </button>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Reservations hold your booth for a {RESERVATION_HOURS}-hour window. Unless it&apos;s covered by an Insiders+ free reservation, you&apos;ll be redirected to Stripe
              to pay securely; the fee covers the reservation only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <legend className="font-display mb-3 flex items-center gap-2.5 text-lg leading-none">
      <span aria-hidden="true" className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-[4px] bg-[var(--foreground)] text-sm text-[var(--gold)]">
        {n}
      </span>
      {children}
    </legend>
  );
}

export type BoothMe = { name: string; email: string; phone: string | null; plus: boolean };

// `formToken` (stamped when the page was built) goes back with the
// reservation for the bot check on free Insiders+ bookings
// (lib/public-form-guard.ts), with the hidden field in the pop-up.
export default function BoothReservationForm({
  booths,
  initialDate,
  initialReservations,
  me = null,
  formToken,
}: {
  booths: Booth[];
  initialDate: string;
  initialReservations: BoothBusy[];
  me?: BoothMe | null;
  formToken: string;
}) {
  // Same-day booking is disabled (see actions.ts) so no one reserves a seat
  // out from under a customer who's currently sitting in it -- initialDate
  // is already "tomorrow" as computed by the page, this is just the floor
  // for the date picker itself.
  const minDate = initialDate;
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
      <BoothPhotoGrid booths={booths} selectedId={boothId} bookedIds={bookedIds} onSelect={setBoothId} />

      {selectedBooth && (
        <BoothDetailModal
          booth={selectedBooth}
          date={date}
          minDate={minDate}
          onDateChange={handleDateChange}
          loadingAvailability={loadingAvailability}
          bookedWindows={bookedWindowsByBooth.get(selectedBooth.id) ?? []}
          onClose={() => setBoothId(null)}
          me={me}
          formToken={formToken}
        />
      )}
    </div>
  );
}
