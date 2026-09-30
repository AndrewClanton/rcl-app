"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Movie, Room, Screening } from "@/lib/types";
import type { ScreeningTicket, TicketCount } from "@/lib/data/screenings";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { PosterOption } from "@/lib/tmdb-posters";
import ManagerPinModal from "@/components/ManagerPinModal";
import InfoTip from "@/components/help/InfoTip";
import { approvalText } from "@/lib/pin-rules";
import { refundBooking } from "../reports/actions";
import {
  searchMovieDatabase,
  importMovie,
  getPosterOptions,
  setMoviePoster,
  addMovieManually,
  addScreening,
  updateScreening,
  deleteScreening,
  listScreeningTickets,
  type MovieSearchResult,
  type ScreeningFields,
} from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Showtimes are Central time whatever the computer showing this page is set
// to (a manager checking the schedule from out of town included).
const TZ = "America/Chicago";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// A screening's Central date and time, for the Edit form's date and time boxes.
function centralParts(iso: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const NO_TICKETS: TicketCount = { sold: 0, bookings: 0, paying: 0 };

export default function ScreeningManager({
  movies,
  rooms,
  screenings,
  tickets,
}: {
  movies: Movie[];
  rooms: Room[];
  screenings: Screening[];
  tickets: Record<string, TicketCount>;
}) {
  return (
    <div className="space-y-8">
      <MovieImporter movies={movies} />
      <MovieLibrary movies={movies} />
      <ScreeningScheduler movies={movies} rooms={rooms} />
      <UpcomingScreenings screenings={screenings} tickets={tickets} movies={movies} rooms={rooms} />
    </div>
  );
}
function MovieLibrary({ movies }: { movies: Movie[] }) {
  const [pending, run] = useRefreshingAction();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [options, setOptions] = useState<PosterOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  async function openPicker(movieId: string) {
    setOpenFor(movieId);
    setOptions([]);
    setOptionsError(null);
    setLoadingOptions(true);
    const result = await getPosterOptions(movieId);
    setLoadingOptions(false);
    if (!result.ok) return setOptionsError(result.error);
    if (result.options.length === 0) setOptionsError("No alternate posters found for this movie.");
    setOptions(result.options);
  }

  const openMovie = movies.find((m) => m.id === openFor);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Movie library</h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
        {movies.map((m) => (
          <div key={m.id}>
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-hover)]">
              {m.poster_url && (
                // Candidate thumbnails come straight from TMDb until one is picked and re-hosted, so next/image (which only allows our own storage domain) doesn't apply here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.poster_url} alt={m.title} className="h-full w-full object-cover" />
              )}
            </div>
            <div className="mt-1 line-clamp-1 text-xs font-medium" title={m.title}>
              {m.title}
            </div>
            <button className="text-[11px] text-[var(--accent)] hover:underline" onClick={() => openPicker(m.id)}>
              Change poster
            </button>
          </div>
        ))}
      </div>

      {openMovie && (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--border)] p-3 ">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Choose a poster for {openMovie.title}</div>
            <button className="text-xs text-[var(--muted)] hover:underline" onClick={() => setOpenFor(null)}>
              Close
            </button>
          </div>
          {loadingOptions && <div className="text-sm text-[var(--muted)]">Loading options...</div>}
          {optionsError && (
            <div className="rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2 text-sm text-[var(--warn-text)] ">{optionsError}</div>
          )}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {options.map((o) => (
              <button
                key={o.url}
                disabled={pending}
                className="overflow-hidden rounded border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    const result = await setMoviePoster(openMovie.id, o.url);
                    if (!result.ok) return setOptionsError(result.error);
                    setOpenFor(null);
                  })
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.url} alt="" className="aspect-[2/3] w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MovieImporter({ movies }: { movies: Movie[] }) {
  const [pending, run] = useRefreshingAction();
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [results, setResults] = useState<MovieSearchResult[]>([]);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualRuntime, setManualRuntime] = useState("");
  const [manualRating, setManualRating] = useState("");
  const [manualSynopsis, setManualSynopsis] = useState("");

  async function runSearch() {
    setError(null);
    setSearchedFor(null);
    const result = await searchMovieDatabase(query, year);
    if (!result.ok) {
      setError(result.error);
      setResults([]);
      return;
    }
    setResults(result.results);
    setSearchedFor(query.trim() + (year.trim() ? ` (${year.trim()})` : ""));
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Movies</h2>

      <div className="mb-3 flex gap-2">
        <input
          className="flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
          placeholder="Search for a movie title..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
        />
        <input
          className="w-20 rounded border border-[var(--border)] px-2 py-1 text-sm "
          placeholder="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
        />
        <button className="rounded border border-[var(--border)] px-3 py-1 text-sm " onClick={runSearch}>
          Search
        </button>
      </div>
      <div className="mb-3 -mt-2 text-xs text-[var(--muted)]">
        Best matches come first. If the right one isn&apos;t there, add the release year.
      </div>

      {error && (
        <div className="mb-3 rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2 text-sm text-[var(--warn-text)] ">
          {error} You can still add a movie manually below.
        </div>
      )}

      {searchedFor && results.length === 0 && (
        <div className="mb-3 text-sm text-[var(--muted)]">
          No movies found for &quot;{searchedFor}&quot;. Try a different spelling or year, or add it manually below.
        </div>
      )}

      {results.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <button
              key={r.id}
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await importMovie(r.id);
                  if (!result.ok) setError(result.error);
                })
              }
              className="flex gap-2 rounded border border-[var(--border)] p-2 text-left text-xs hover:border-[var(--foreground)]"
              title={r.overview ?? undefined}
            >
              {r.posterThumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- tiny remote thumbnail; next/image would need TMDb whitelisted
                <img src={r.posterThumb} alt="" width={40} height={60} className="h-[60px] w-10 shrink-0 rounded object-cover" loading="lazy" />
              ) : (
                <div className="h-[60px] w-10 shrink-0 rounded bg-[var(--surface-hover)]" />
              )}
              <div className="min-w-0">
                <div className="font-medium">{r.title}</div>
                <div className="text-[var(--muted)]">{r.year || "—"}</div>
                {r.overview && <div className="mt-0.5 line-clamp-2 text-[var(--muted)]">{r.overview}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      <button className="mb-2 text-xs text-[var(--muted)] hover:underline" onClick={() => setManualOpen((v) => !v)}>
        {manualOpen ? "Hide manual entry" : "Add a movie manually instead"}
      </button>
      {manualOpen && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--border)] p-3 ">
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Title</label>
            <input
              className="rounded border border-[var(--border)] px-2 py-1 text-sm "
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Runtime (min)</label>
            <input
              type="number"
              className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm "
              value={manualRuntime}
              onChange={(e) => setManualRuntime(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">Rating</label>
            <input
              className="w-20 rounded border border-[var(--border)] px-2 py-1 text-sm "
              placeholder="PG-13"
              value={manualRating}
              onChange={(e) => setManualRating(e.target.value)}
            />
          </div>
          <div className="w-full">
            <label className="mb-1 block text-xs text-[var(--muted)]">Synopsis</label>
            <textarea
              className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
              rows={2}
              value={manualSynopsis}
              onChange={(e) => setManualSynopsis(e.target.value)}
            />
          </div>
          <button
            className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50 "
            disabled={pending || !manualTitle.trim()}
            onClick={() => {
              const fields = {
                title: manualTitle,
                synopsis: manualSynopsis,
                runtime_minutes: manualRuntime ? parseInt(manualRuntime, 10) : undefined,
                rating: manualRating,
              };
              setManualTitle("");
              setManualRuntime("");
              setManualRating("");
              setManualSynopsis("");
              setManualOpen(false);
              run(() => addMovieManually(fields));
            }}
          >
            Add movie
          </button>
        </div>
      )}

      <div className="text-sm text-[var(--muted)]">{movies.length} movie(s) in the library.</div>
    </section>
  );
}

function isOutdoorRoom(room: Room | undefined) {
  return !!room?.name.toLowerCase().includes("outdoor");
}

const INPUT = "rounded border border-[var(--border)] px-2 py-1 text-sm";
const LABEL = "mb-1 block text-xs text-[var(--muted)]";

interface FormState {
  movieId: string;
  roomId: string;
  date: string;
  time: string;
  price: string;
  capacity: string;
}

function toFields(f: FormState): ScreeningFields | null {
  const price = parseFloat(f.price);
  const capacity = parseInt(f.capacity, 10);
  if (!f.movieId || !f.roomId || !f.date || !f.time || !(price >= 0) || !(capacity > 0)) return null;
  return { movie_id: f.movieId, room_id: f.roomId, date: f.date, time: f.time, ticket_price: price, capacity };
}

// The movie/room/date/time/price/capacity boxes, shared by "Schedule a
// screening" and Edit. Picking a room fills in its capacity (and $0 for the
// outdoor screen, which is free).
function ScreeningFieldsForm({
  movies,
  screeningRooms,
  value,
  onChange,
}: {
  movies: Movie[];
  screeningRooms: Room[];
  value: FormState;
  onChange: (next: FormState) => void;
}) {
  const outdoor = isOutdoorRoom(screeningRooms.find((r) => r.id === value.roomId));
  const set = (patch: Partial<FormState>) => onChange({ ...value, ...patch });
  return (
    <>
      <div>
        <label className={LABEL}>Movie</label>
        <select className={INPUT} value={value.movieId} onChange={(e) => set({ movieId: e.target.value })}>
          <option value="">Select a movie...</option>
          {movies.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL}>Room</label>
        <select
          className={INPUT}
          value={value.roomId}
          onChange={(e) => {
            const r = screeningRooms.find((r) => r.id === e.target.value);
            set({ roomId: e.target.value, ...(r ? { capacity: String(r.capacity) } : {}), ...(isOutdoorRoom(r) ? { price: "0" } : {}) });
          }}
        >
          {screeningRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL}>Date</label>
        <input type="date" className={INPUT} value={value.date} onChange={(e) => set({ date: e.target.value })} />
      </div>
      <div>
        <label className={LABEL}>Time (Central)</label>
        <input type="time" className={INPUT} value={value.time} onChange={(e) => set({ time: e.target.value })} />
      </div>
      <div>
        <label className={LABEL}>Ticket price</label>
        <input
          type="number"
          step="0.01"
          min="0"
          disabled={outdoor}
          className={`w-24 ${INPUT} disabled:opacity-50`}
          value={value.price}
          onChange={(e) => set({ price: e.target.value })}
        />
        {outdoor && <div className="mt-0.5 text-[10px] text-[var(--muted)]">Free — sponsored by the Royale Cinema Project</div>}
      </div>
      <div>
        <label className={LABEL}>Capacity</label>
        <input type="number" min="1" className={`w-24 ${INPUT}`} value={value.capacity} onChange={(e) => set({ capacity: e.target.value })} />
      </div>
    </>
  );
}

function ScreeningScheduler({ movies, rooms }: { movies: Movie[]; rooms: Room[] }) {
  const [pending, run] = useRefreshingAction();
  const screeningRooms = rooms.filter((r) => r.is_screening_room);
  const initialRoom = screeningRooms[0];
  const [form, setForm] = useState<FormState>({
    movieId: "",
    roomId: initialRoom?.id ?? "",
    date: "",
    time: "",
    price: isOutdoorRoom(initialRoom) ? "0" : "8",
    capacity: String(initialRoom?.capacity ?? ""),
  });
  const fields = toFields(form);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">
        Schedule a screening
        <InfoTip topic="screenings-schedule" />
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <ScreeningFieldsForm movies={movies} screeningRooms={screeningRooms} value={form} onChange={setForm} />
        <button
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50 "
          disabled={pending || !fields}
          onClick={() => {
            if (!fields) return;
            run(async () => {
              const r = await addScreening(fields);
              // Clear the date and time only once it saved, so a failed save can be retried.
              if (r.ok) setForm((f) => ({ ...f, date: "", time: "" }));
              return r;
            });
          }}
        >
          Schedule screening
        </button>
      </div>
      {screeningRooms.length === 0 && <div className="mt-2 text-sm text-[var(--warn-text)]">No rooms are marked as screening rooms yet.</div>}
    </section>
  );
}

const SCREENING_ROW_GRID = "grid grid-cols-[1.6fr_1.3fr_1fr_60px_84px_170px] items-center gap-3";

function UpcomingScreenings({
  screenings,
  tickets,
  movies,
  rooms,
}: {
  screenings: Screening[];
  tickets: Record<string, TicketCount>;
  movies: Movie[];
  rooms: Room[];
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Upcoming screenings</h2>
      {screenings.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">No screenings scheduled yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[700px] text-sm">
            <div className={`${SCREENING_ROW_GRID} border-b border-[var(--border)] pb-1.5 text-xs font-medium text-[var(--muted)]`}>
              <span>Movie</span>
              <span>When (Central)</span>
              <span>Room</span>
              <span className="text-right">Price</span>
              <span className="text-right">Sold / cap</span>
              <span />
            </div>
            <div className="divide-y divide-[var(--border)]">
              {screenings.map((s) => (
                <ScreeningRow key={s.id} screening={s} count={tickets[s.id] ?? NO_TICKETS} movies={movies} rooms={rooms} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ScreeningRow({ screening: s, count, movies, rooms }: { screening: Screening; count: TicketCount; movies: Movie[]; rooms: Room[] }) {
  const [pending, run, error, clearError] = useRefreshingAction();
  const [editing, setEditing] = useState(false);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const full = count.sold >= s.capacity;

  return (
    <div className="py-2">
      <div className={SCREENING_ROW_GRID}>
        <span className="truncate font-medium" title={s.movie.title}>
          {s.movie.title}
        </span>
        <span className="text-[var(--muted)]">{when(s.starts_at)}</span>
        <span className="truncate text-[var(--muted)]" title={s.room.name}>
          {s.room.name}
        </span>
        <span className="text-right text-[var(--muted)]">{s.ticket_price === 0 ? "Free" : money(s.ticket_price)}</span>
        <button
          className={`text-right tabular-nums hover:underline ${count.sold > 0 ? "font-semibold" : "text-[var(--muted)]"} ${full ? "text-[var(--accent)]" : ""}`}
          title={`${count.sold} sold${count.paying ? `, ${count.paying} being paid for right now` : ""}. Click for the list.`}
          onClick={() => setTicketsOpen((v) => !v)}
        >
          {count.sold} / {s.capacity}
          {count.paying > 0 && <span className="text-xs font-normal text-[var(--muted)]"> +{count.paying}</span>}
        </button>
        <span className="flex justify-end gap-1.5">
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setTicketsOpen((v) => !v)}>
            Tickets
          </button>
          <button
            className="rounded border border-[var(--border)] px-2 py-1 text-xs"
            onClick={() => {
              clearError();
              setEditing((v) => !v);
            }}
          >
            Edit
          </button>
          <button
            className="rounded border border-[var(--danger-text)] px-2 py-1 text-xs text-[var(--danger-text)] disabled:opacity-40"
            disabled={pending}
            title={count.sold > 0 ? "Tickets are sold for this showing. Refund them first, or use Edit to move it." : undefined}
            onClick={() => {
              if (confirm(`Remove this screening of "${s.movie.title}"?`)) run(() => deleteScreening(s.id), { quiet: true });
            }}
          >
            Remove
          </button>
        </span>
      </div>
      {error && (
        <div className="notice notice-warn mt-2 flex items-start gap-2 !p-2.5 text-sm">
          <span className="min-w-0 flex-1">{error}</span>
          <button className="text-xs text-[var(--muted)] underline" onClick={clearError}>
            Close
          </button>
        </div>
      )}
      {editing && <EditScreening screening={s} count={count} movies={movies} rooms={rooms} onDone={() => setEditing(false)} />}
      {ticketsOpen && <TicketsPanel screening={s} />}
    </div>
  );
}

// Changes a screening in place: its bookings stay with it. Moving the time
// or swapping the movie on a showing with tickets sold asks first (the
// server has the final say, and asks again if a ticket sold meanwhile).
function EditScreening({
  screening: s,
  count,
  movies,
  rooms,
  onDone,
}: {
  screening: Screening;
  count: TicketCount;
  movies: Movie[];
  rooms: Room[];
  onDone: () => void;
}) {
  const [pending, run] = useRefreshingAction();
  const screeningRooms = rooms.filter((r) => r.is_screening_room || r.id === s.room_id);
  const start = centralParts(s.starts_at);
  const [form, setForm] = useState<FormState>({
    movieId: s.movie_id,
    roomId: s.room_id,
    date: start.date,
    time: start.time,
    price: String(s.ticket_price),
    capacity: String(s.capacity),
  });
  const fields = toFields(form);
  const held = count.sold + count.paying;
  const timeChanged = form.date !== start.date || form.time !== start.time;
  const priceChanged = fields !== null && fields.ticket_price !== Number(s.ticket_price);

  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--border)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <ScreeningFieldsForm movies={movies} screeningRooms={screeningRooms} value={form} onChange={setForm} />
      </div>
      {held > 0 && timeChanged && (
        <p className="notice notice-warn mt-2 !p-2.5 text-sm">
          {held} ticket{held === 1 ? " is" : "s are"} sold for this showing. Moving it doesn&apos;t tell anyone, so let the ticket holders know (see Tickets).
        </p>
      )}
      {held > 0 && priceChanged && (
        <p className="mt-2 text-xs text-[var(--muted)]">Tickets already sold keep the price they were bought at. The new price is for tickets sold from now on.</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary !px-3 !py-1 text-sm"
          disabled={pending || !fields}
          onClick={() => {
            if (!fields) return;
            run(async () => {
              let r = await updateScreening(s.id, fields);
              if (!r.ok && "confirm" in r) {
                if (!window.confirm(r.confirm)) return;
                r = await updateScreening(s.id, fields, true);
              }
              if (r.ok) onDone();
              return r;
            });
          }}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button className="text-sm text-[var(--muted)] hover:underline" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { refunded: "Refunded", pending: "Paying now" };

// Who holds tickets to one showing. Online tickets refund here (manager
// PIN, card money back through Stripe); a ticket sold at the register is
// part of an order, so it refunds with that order in Reports.
function TicketsPanel({ screening }: { screening: Screening }) {
  const router = useRouter();
  const [rows, setRows] = useState<ScreeningTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<ScreeningTicket | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    listScreeningTickets(screening.id)
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setRows(r.tickets);
          setError(null);
        } else setError(r.error);
      })
      .catch(() => {
        if (live) setError("Couldn't load the tickets. Try again.");
      });
    return () => {
      live = false;
    };
  }, [screening.id, reload]);

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] p-3">
      {done && <div className="notice notice-success mb-2 !p-2.5 text-sm">{done}</div>}
      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      {!rows && !error && <p className="text-sm text-[var(--muted)]">Loading tickets…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-[var(--muted)]">No tickets sold for this showing yet.</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="pb-1 font-medium">Name</th>
              <th className="pb-1 font-medium">Tickets</th>
              <th className="pb-1 text-right font-medium">Paid</th>
              <th className="pb-1 pl-2 font-medium">Where</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const paid = t.quantity * t.unitPrice + t.tax;
              return (
                <tr key={t.id} className={`border-t border-[var(--border)] ${t.status !== "confirmed" ? "text-[var(--muted)]" : ""}`}>
                  <td className="py-1 pr-2">
                    {t.name ?? "—"}
                    {t.email && <div className="text-xs text-[var(--muted)]">{t.email}</div>}
                  </td>
                  <td className="py-1 pr-2">{t.quantity}</td>
                  <td className="py-1 pr-2 text-right">{paid === 0 ? "Free" : money(paid)}</td>
                  <td className="py-1 pl-2 pr-2 text-xs">{t.orderNumber ? `Register, order #${t.orderNumber}` : "Online"}</td>
                  <td className="py-1 text-right text-xs">
                    {t.status !== "confirmed" ? (
                      (STATUS_LABEL[t.status] ?? t.status)
                    ) : t.orderNumber ? (
                      <Link href={`/admin/reports?order=${t.orderNumber}`} className="text-[var(--accent)] hover:underline">
                        Refund in Reports
                      </Link>
                    ) : (
                      <button className="rounded border border-[var(--border)] px-2 py-0.5 hover:border-[var(--accent)]" onClick={() => setRefunding(t)}>
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {refunding && (
        <ManagerPinModal
          description={`Manager approval is required to refund ${refunding.name ?? "this booking"}'s ${refunding.quantity} ticket${refunding.quantity === 1 ? "" : "s"} (${money(
            refunding.quantity * refunding.unitPrice + refunding.tax,
          )}${refunding.paidByCard ? ", back to their card" : ""}).`}
          onCancel={() => setRefunding(null)}
          onSubmit={async (pin) => {
            const r = await refundBooking(refunding.id, pin);
            if (!r.ok) throw new Error(r.error); // shown in the PIN box
            setDone(`${refunding.name ?? "That booking"} refunded. ${approvalText(r)}`);
            setRefunding(null);
            setReload((n) => n + 1);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
