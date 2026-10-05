"use client";

import { useCallback, useEffect, useState } from "react";
import MoviePoster from "@/components/MoviePoster";
import { getRegisterScreenings, type RegisterScreening } from "./ticket-actions";
import { VISIBILITY_LABEL, type ShowingVisibility } from "@/lib/showing-visibility";

// The register's Movies tab: a tile for every showing today and tomorrow,
// each with its seats left. Tapping one picks how many tickets; each ticket
// goes on the order tied to that exact showing.

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
const money = (n: number) => (n === 0 ? "Free" : `$${n.toFixed(2)}`);

// "Private" (a private group's showing: not listed or sold online, only here)
// or "Members only".
function ShowingLabel({ visibility }: { visibility: ShowingVisibility }) {
  const priv = visibility === "private";
  return (
    <span
      className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ background: priv ? "var(--foreground)" : "var(--gold)", color: priv ? "var(--background)" : "var(--foreground)" }}
    >
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}

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
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [picked, setPicked] = useState<RegisterScreening | null>(null);
  const [loadedAt, setLoadedAt] = useState(0); // when the list was fetched, for "Started"

  const load = useCallback(async () => {
    const r = await getRegisterScreenings().catch(() => null);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "Couldn't load today's showings. Check the connection.");
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
  const counts = { today: (shows ?? []).filter((s) => s.day === "today").length, tomorrow: (shows ?? []).filter((s) => s.day === "tomorrow").length };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["today", "tomorrow"] as const).map((d) => (
          <button key={d} className={`chip !px-4 !py-2 text-sm ${day === d ? "chip-selected" : ""}`} onClick={() => setDay(d)}>
            {d === "today" ? "Today" : "Tomorrow"} {shows ? `(${counts[d]})` : ""}
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
          No showings {day === "today" ? "left today" : "tomorrow"}. Add them in Admin → Screenings.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {list.map((s) => {
          const seats = left(s);
          const started = loadedAt > 0 && new Date(s.startsAt).getTime() < loadedAt;
          return (
            <button
              key={s.id}
              className="card-flat flex flex-col gap-2 p-2 text-left disabled:opacity-45"
              disabled={seats === 0}
              onClick={() => setPicked(s)}
              aria-label={`${s.title}, ${time(s.startsAt)}, ${seats} seats left`}
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
                  {s.visibility !== "public" && <ShowingLabel visibility={s.visibility} />}
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
            {show.visibility !== "public" && <ShowingLabel visibility={show.visibility} />}
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
          <button className="text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
