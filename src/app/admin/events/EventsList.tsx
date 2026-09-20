"use client";

import { useState } from "react";
import type { EventRecord } from "@/lib/data/events";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { markEventPaid, markEventOutstanding, updateEventGuestCount, deleteEvent } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function EventsList({ events }: { events: EventRecord[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] p-6 text-center text-sm text-[var(--muted)] ">
        No upcoming events booked. Past events are hidden automatically.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((ev) => (
        <EventRow key={ev.id} event={ev} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: EventRecord }) {
  const [pending, run] = useRefreshingAction();
  const [guests, setGuests] = useState(event.guest_count?.toString() ?? "");

  const metaLines = [
    `${event.room.name}, ${event.hours} hr`,
    event.movie_title ? `Movie: ${event.movie_title}` : null,
    `Organizer: ${event.organizer_name ? `${event.organizer_name} — ` : ""}${event.organizer_email}`,
    `Total ${money(event.estimate_total)} — paid ${money(event.deposit_paid)} — balance ${money(event.balance_due)}`,
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-[var(--border)] p-4 ">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {event.event_name} — {event.event_date} {event.event_time}
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-[var(--muted)]">
            {metaLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
        <span
          className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            event.status === "paid" ? "border-green-500 text-green-600" : "border-[var(--danger-text)] text-[var(--danger-text)]"
          }`}
        >
          {event.status === "paid" ? "Paid" : "Outstanding"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Guests:
          <input
            type="number"
            min="0"
            className="w-16 rounded border border-[var(--border)] px-1 py-0.5 text-sm "
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            onBlur={() => run(() => updateEventGuestCount(event.id, guests ? parseInt(guests, 10) : null))}
          />
        </label>

        {event.status === "outstanding" ? (
          <button
            className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50 "
            disabled={pending}
            onClick={() => run(() => markEventPaid(event.id))}
          >
            Mark paid manually
          </button>
        ) : (
          <button
            className="rounded border border-[var(--border)] px-3 py-1 text-xs "
            disabled={pending}
            onClick={() => run(() => markEventOutstanding(event.id))}
          >
            Mark outstanding
          </button>
        )}

        <button
          className="ml-auto rounded border border-[var(--danger-text)] px-3 py-1 text-xs text-[var(--danger-text)] "
          disabled={pending}
          onClick={() => {
            if (confirm("Remove this event record?")) run(() => deleteEvent(event.id));
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
