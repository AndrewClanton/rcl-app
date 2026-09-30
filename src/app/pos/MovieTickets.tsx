"use client";

import { useCallback, useEffect, useState } from "react";
import MoviePoster from "@/components/MoviePoster";
import { getRegisterScreenings, type RegisterScreening } from "./ticket-actions";

// The register's Movies tab: a tile for every showing today and tomorrow,
// each with its seats left, and under Later the two weeks after that, by
// day. Tapping one picks how many tickets; each ticket goes on the order
// tied to that exact showing.

export interface TicketLine {
  screeningId: string;
  name: string;
  unit: number;
  qty: number;
  mods: string[];
}

const TZ = "America/Chicago";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
// A business date ("2026-10-09") as "Friday, Oct 9".
const dateHeading = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const money = (n: number) => (n === 0 ? "Free" : `$${n.toFixed(2)}`);

type Day = RegisterScreening["day"];
const DAYS: { key: Day; label: string; none: string }[] = [
  { key: "today", label: "Today", none: "No showings left today." },
  { key: "tomorrow", label: "Tomorrow", none: "No showings tomorrow." },
  { key: "later", label: "Later", none: "No showings in the two weeks after tomorrow." },
];

export default function MovieTickets({
  initial,
  inCart,
  insidersPlus,
  onAdd,
}: {
  initial: RegisterScreening[]; // loaded with the page, refreshed every minute here
  inCart: Map<string, number>; // tickets already on this order, per showing
  insidersPlus: boolean; // the attached member can take a free Insiders+ entry
  onAdd: (line: TicketLine) => void;
}) {
  const [shows, setShows] = useState<RegisterScreening[] | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<Day>("today");
  const [picked, setPicked] = useState<RegisterScreening | null>(null);
  const [loadedAt, setLoadedAt] = useState(0); // when the list was fetched, for "Started"

  const load = useCallback(async () => {
    const r = await getRegisterScreenings().catch(() => null);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't load the showings. Check the connection.");
    setError(null);
    setShows(r.screenings);
    setLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const left = (s: RegisterScreening) => Math.max(0, s.capacity - s.sold - (inCart.get(s.id) ?? 0));
  const list = (shows ?? []).filter((s) => s.day === day);
  const count = (d: Day) => (shows ?? []).filter((s) => s.day === d).length;
  // Later has a heading for each date; the list is already in start order.
  const groups: { date: string | null; shows: RegisterScreening[] }[] = [];
  for (const s of list) {
    const date = day === "later" ? s.date : null;
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.shows.push(s);
    else groups.push({ date, shows: [s] });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {DAYS.map((d) => (
          <button key={d.key} className={`chip !px-4 !py-2 text-sm ${day === d.key ? "chip-selected" : ""}`} onClick={() => setDay(d.key)}>
            {d.label} {shows ? `(${count(d.key)})` : ""}
          </button>
        ))}
        <button className="ml-auto text-xs hover:underline" style={{ color: "var(--muted)" }} onClick={load}>
          Refresh seats
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger-text)" }}>
          {error}
        </p>
      )}
      {!shows && !error && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading showings…</p>}
      {shows && list.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {DAYS.find((d) => d.key === day)?.none} Add them in Admin → Screenings.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.date ?? day} className="space-y-2">
          {g.date && <div className="eyebrow pt-1">{dateHeading(g.date)}</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {g.shows.map((s) => {
              const seats = left(s);
              const started = loadedAt > 0 && new Date(s.startsAt).getTime() < loadedAt;
              return (
                <button
                  key={s.id}
                  className="card-flat flex flex-col gap-2 p-2 text-left disabled:opacity-45"
                  disabled={seats === 0}
                  onClick={() => setPicked(s)}
                  aria-label={`${s.title}, ${s.day === "today" ? "" : `${dayLabel(s.startsAt)}, `}${time(s.startsAt)}, ${seats} seats left`}
                >
                  <div className="flex gap-2">
                    <div className="w-14 shrink-0">
                      <MoviePoster posterUrl={s.posterUrl} title={s.title} sizes="56px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-bold leading-tight" style={{ color: "var(--foreground)" }}>
                        {s.title}
                      </div>
                      <div className="mt-1 text-lg font-bold" style={{ color: "var(--accent)" }}>
                        {time(s.startsAt)}
                      </div>
                      <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                        {s.room}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold" style={{ color: "var(--foreground)" }}>{money(s.price)}</span>
                    <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: seats === 0 ? "var(--danger-bg, #fde8e8)" : seats <= 5 ? "var(--gold)" : "var(--surface-hover)", color: seats === 0 ? "var(--danger-text)" : "var(--foreground)" }}>
                      {seats === 0 ? "Sold out" : started ? `Started · ${seats} left` : `${seats} left`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {picked && (
        <TicketPicker
          show={picked}
          seatsLeft={left(picked)}
          insidersPlus={insidersPlus}
          onCancel={() => setPicked(null)}
          onAdd={(qty, free) => {
            onAdd({
              screeningId: picked.id,
              name: `${free ? "Insiders+ entry" : "Ticket"}: ${picked.title} ${time(picked.startsAt)}`,
              unit: free ? 0 : picked.price,
              qty,
              mods: [dayLabel(picked.startsAt), picked.room].filter(Boolean),
            });
            setPicked(null);
          }}
        />
      )}
    </div>
  );
}

function TicketPicker({
  show,
  seatsLeft,
  insidersPlus,
  onAdd,
  onCancel,
}: {
  show: RegisterScreening;
  seatsLeft: number;
  insidersPlus: boolean;
  onAdd: (qty: number, free: boolean) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(1);
  const max = Math.max(1, seatsLeft);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3">
          <div className="w-20 shrink-0">
            <MoviePoster posterUrl={show.posterUrl} title={show.title} sizes="80px" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-xl leading-tight">{show.title}</h3>
            <div className="mt-1 text-lg font-bold" style={{ color: "var(--accent)" }}>
              {dayLabel(show.startsAt)} · {time(show.startsAt)}
            </div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              {show.room}
              {show.runtime ? ` · ${show.runtime} min` : ""}
              {show.rating ? ` · ${show.rating}` : ""}
            </div>
            <div className="mt-1 text-sm font-bold">{seatsLeft} seat{seatsLeft === 1 ? "" : "s"} left</div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-4">
          <button className="h-12 w-12 rounded-lg border text-2xl" style={{ borderColor: "var(--border)" }} onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One fewer ticket">
            −
          </button>
          <span className="w-10 text-center font-display text-3xl" aria-live="polite">
            {qty}
          </span>
          <button className="h-12 w-12 rounded-lg border text-2xl" style={{ borderColor: "var(--border)" }} onClick={() => setQty((q) => Math.min(max, q + 1))} aria-label="One more ticket" disabled={qty >= max}>
            +
          </button>
        </div>

        <div className="grid gap-2">
          <button className="btn-primary w-full py-3 text-base" disabled={seatsLeft < 1} onClick={() => onAdd(Math.min(qty, max), false)}>
            Add {qty} ticket{qty === 1 ? "" : "s"} · {money(show.price * qty)}
          </button>
          {insidersPlus && (
            <button className="btn-secondary w-full py-3 text-base" disabled={seatsLeft < 1} onClick={() => onAdd(1, true)}>
              Add Insiders+ entry (free, 1 seat)
            </button>
          )}
          <button className="btn-secondary min-h-11 w-full text-base" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
