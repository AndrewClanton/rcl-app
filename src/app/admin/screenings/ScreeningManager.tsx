"use client";

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type Ref, type RefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Movie, Room, Screening } from "@/lib/types";
import type { ScreeningTicket, TicketCount } from "@/lib/data/screenings";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { PosterOption } from "@/lib/tmdb-posters";
import { SHOWING_VISIBILITIES, VISIBILITY_LABEL, isOutdoorRoom, visibilityOf, type ShowingVisibility } from "@/lib/showing-visibility";
import ManagerPinModal from "@/components/ManagerPinModal";
import ConfirmModal from "@/components/ConfirmModal";
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
  addScreenings,
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

// The series tags a showing can carry (Back office -> Badges -> Series
// tags), for the forms further down.
const SeriesTags = createContext<string[]>([]);

// `canEdit`: a manager or up. Anyone else gets the movies, the schedule and
// the ticket lists, without the scheduler or Duplicate, Edit and Remove.
export default function ScreeningManager({
  movies,
  rooms,
  screenings,
  tickets,
  canEdit,
  seriesTags = [],
}: {
  movies: Movie[];
  rooms: Room[];
  screenings: Screening[];
  tickets: Record<string, TicketCount>;
  canEdit: boolean;
  seriesTags?: string[];
}) {
  const [draft, setDraft] = useState<Draft>(() => blankDraft(rooms));
  const schedulerRef = useRef<HTMLElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // Duplicate on a showing: its movie, room, time, price and capacity go
  // into the scheduler, and the date is left for the person to pick.
  function duplicate(s: Screening) {
    flushSync(() =>
      setDraft({
        form: { movieId: s.movie_id, roomId: s.room_id, date: "", time: centralParts(s.starts_at).time, price: String(s.ticket_price), capacity: String(s.capacity), visibility: visibilityOf(s), series: s.series ?? "" },
        repeat: null,
        note: { tone: "info", text: `Copied from ${s.movie.title} (${when(s.starts_at)}). Pick a date for the new showing, or use Repeat to add several.` },
      }),
    );
    schedulerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    dateRef.current?.focus({ preventScroll: true });
  }

  return (
    <SeriesTags.Provider value={seriesTags}>
    <div className="space-y-8">
      <MovieImporter movies={movies} />
      <MovieLibrary movies={movies} />
      {canEdit && (
        <ScreeningScheduler
          movies={movies}
          rooms={rooms}
          screenings={screenings}
          draft={draft}
          setDraft={setDraft}
          sectionRef={schedulerRef}
          dateRef={dateRef}
        />
      )}
      <UpcomingScreenings screenings={screenings} tickets={tickets} movies={movies} rooms={rooms} canEdit={canEdit} onDuplicate={duplicate} />
    </div>
    </SeriesTags.Provider>
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

const VISIBILITY_HELP: Record<ShowingVisibility, string> = {
  public: "On the website, the lobby TVs and the weekly email, as usual.",
  members: "Only signed-in members see it on the website, marked Members only. It goes in the members-only part of the email, not the lobby TV.",
  private: "Never on the website, TVs or emails, and not sold online. It stays here and on the register, labelled Private, to ring up.",
};

// Who a showing is listed for, as a small badge (none for Public: the
// usual case stays quiet).
function VisibilityBadge({ visibility }: { visibility: ShowingVisibility }) {
  if (visibility === "public") return null;
  return (
    <span
      className={`ml-1.5 inline-block rounded-full px-2 py-0.5 align-middle text-[11px] font-bold ${visibility === "private" ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--gold)] text-[var(--foreground)]"}`}
      title={VISIBILITY_HELP[visibility]}
    >
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}

const INPUT = "min-h-11 rounded-lg border border-[var(--border)] px-3 text-base";
const LABEL = "mb-1 block text-xs text-[var(--muted)]";
const BUTTON = "min-h-11 rounded-lg border border-[var(--border)] px-3 text-base hover:border-[var(--foreground)] disabled:opacity-40";
const ROW_BUTTON = "min-h-10 rounded-lg border border-[var(--border)] px-3 text-base hover:border-[var(--foreground)] disabled:opacity-40";
const CHIP = "chip inline-flex min-h-10 items-center gap-1.5 !px-4 !text-base";

interface FormState {
  movieId: string;
  roomId: string;
  date: string;
  time: string;
  price: string;
  capacity: string;
  visibility: ShowingVisibility;
  series: string; // "": none
}

function toFields(f: FormState): ScreeningFields | null {
  const price = parseFloat(f.price);
  const capacity = parseInt(f.capacity, 10);
  if (!f.movieId || !f.roomId || !f.date || !f.time || !(price >= 0) || !(capacity > 0)) return null;
  return { movie_id: f.movieId, room_id: f.roomId, date: f.date, time: f.time, ticket_price: price, capacity, visibility: f.visibility, series: f.series || null };
}

// Repeat: the same showing at each start time, on each chosen weekday, from
// the first date to the last. Dates and times are Central wall-clock, as
// typed; the server turns each one into an instant.
interface RepeatState {
  from: string; // YYYY-MM-DD
  to: string;
  days: number[]; // 0 = Sunday
  times: string[]; // HH:MM, earliest first
  leftOut: string[]; // "YYYY-MM-DD HH:MM" taken off the list by hand
}

// What's in the scheduler. Kept up here so Duplicate (on a row further
// down) can fill it in.
interface Draft {
  form: FormState;
  repeat: RepeatState | null; // null: one showing
  note: { tone: "info" | "success"; text: string } | null;
}

function blankDraft(rooms: Room[]): Draft {
  const room = rooms.find((r) => r.is_screening_room);
  return {
    form: { movieId: "", roomId: room?.id ?? "", date: "", time: "", price: isOutdoorRoom(room) ? "0" : "8", capacity: String(room?.capacity ?? ""), visibility: isOutdoorRoom(room) ? "members" : "public", series: "" },
    repeat: null,
    note: null,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// addScreenings refuses more than this in one save too.
const MOST_AT_ONCE = 200;

// "2026-10-03" -> "Sat, Oct 3". A calendar date, so no time zone applies.
function dayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// "19:00" -> "7:00 PM".
function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The dates from `from` to `to` that fall on one of `days`. Null when the
// range is over a year (a mistyped year, most likely).
function repeatDates(from: string, to: string, days: number[]): string[] | null {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (!(end >= start)) return [];
  if (end - start > 366 * 86_400_000) return null;
  const out: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    if (days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// The movie/room/date/time/price/capacity boxes, shared by "Schedule a
// screening" and Edit. Picking a room fills in its capacity (and $0 for the
// outdoor screen, which is free). Repeat has its own dates and times, so it
// leaves out the date and time boxes (`withDateTime` false).
function ScreeningFieldsForm({
  movies,
  screeningRooms,
  value,
  onChange,
  withDateTime = true,
  dateRef,
}: {
  movies: Movie[];
  screeningRooms: Room[];
  value: FormState;
  onChange: (next: FormState) => void;
  withDateTime?: boolean;
  dateRef?: Ref<HTMLInputElement>;
}) {
  const outdoor = isOutdoorRoom(screeningRooms.find((r) => r.id === value.roomId));
  const set = (patch: Partial<FormState>) => onChange({ ...value, ...patch });
  const seriesTags = useContext(SeriesTags);
  const seriesChoices = [...new Set([...seriesTags, ...(value.series ? [value.series] : [])])];
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
            set({ roomId: e.target.value, ...(r ? { capacity: String(r.capacity) } : {}), ...(isOutdoorRoom(r) ? { price: "0", ...(value.visibility === "public" ? { visibility: "members" as const } : {}) } : {}) });
          }}
        >
          {screeningRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {withDateTime && (
        <>
          <div>
            <label className={LABEL}>Date</label>
            <input ref={dateRef} type="date" className={INPUT} value={value.date} onChange={(e) => set({ date: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Time (Central)</label>
            <input type="time" className={INPUT} value={value.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
        </>
      )}
      <div>
        <label className={LABEL}>Ticket price</label>
        <input
          type="number"
          step="0.01"
          min="0"
          disabled={outdoor}
          className={`w-28 ${INPUT} disabled:opacity-50`}
          value={value.price}
          onChange={(e) => set({ price: e.target.value })}
        />
        {outdoor && <div className="mt-0.5 text-[10px] text-[var(--muted)]">Free — sponsored by the Royale Cinema Project</div>}
      </div>
      <div>
        <label className={LABEL}>Capacity</label>
        <input type="number" min="1" className={`w-28 ${INPUT}`} value={value.capacity} onChange={(e) => set({ capacity: e.target.value })} />
      </div>
      <fieldset className="basis-full">
        <legend className={LABEL}>Who sees it</legend>
        <div className="flex flex-wrap gap-2">
          {SHOWING_VISIBILITIES.filter((v) => !(outdoor && v === "public")).map((v) => (
            <button key={v} type="button" className={`${CHIP} ${value.visibility === v ? "chip-selected" : ""}`} aria-pressed={value.visibility === v} onClick={() => set({ visibility: v })}>
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="mt-1 max-w-xl text-xs text-[var(--muted)]">{outdoor && value.visibility === "public" ? "The outdoor screen is never public. Pick Members only or Private." : VISIBILITY_HELP[value.visibility]}</div>
      </fieldset>
      <div>
        <label className={LABEL}>Series (optional)</label>
        <select className={INPUT} value={value.series} onChange={(e) => set({ series: e.target.value })}>
          <option value="">No series</option>
          {seriesChoices.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="mt-0.5 text-[10px] text-[var(--muted)]">For event badges: &ldquo;came to 3 Horror Month showings&rdquo;.</div>
      </div>
    </>
  );
}

function ScreeningScheduler({
  movies,
  rooms,
  screenings,
  draft,
  setDraft,
  sectionRef,
  dateRef,
}: {
  movies: Movie[];
  rooms: Room[];
  screenings: Screening[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  sectionRef: RefObject<HTMLElement | null>;
  dateRef: RefObject<HTMLInputElement | null>;
}) {
  const [pending, run, error, clearError] = useRefreshingAction();
  const [newTime, setNewTime] = useState("");
  const { form, repeat, note } = draft;
  const screeningRooms = rooms.filter((r) => r.is_screening_room || r.id === form.roomId);
  const movieTitle = movies.find((m) => m.id === form.movieId)?.title ?? "the movie";
  const fields = toFields(form);

  const setForm = (next: FormState) => setDraft((d) => ({ ...d, form: next }));
  const setRepeat = (patch: Partial<RepeatState>) => setDraft((d) => (d.repeat ? { ...d, repeat: { ...d.repeat, ...patch } } : d));

  function startRepeat() {
    setDraft((d) =>
      d.repeat
        ? d
        : {
            ...d,
            repeat: { from: d.form.date, to: d.form.date ? addDays(d.form.date, 6) : "", days: [0, 1, 2, 3, 4, 5, 6], times: d.form.time ? [d.form.time] : [], leftOut: [] },
          },
    );
  }

  function addTime() {
    const t = newTime.slice(0, 5);
    setNewTime("");
    if (!repeat || !/^\d{2}:\d{2}$/.test(t) || repeat.times.includes(t)) return;
    setRepeat({ times: [...repeat.times, t].sort() });
  }

  // The showings Repeat would add. One the room already has at that time
  // is listed but left out (the server refuses it too).
  const taken = new Set(
    screenings
      .filter((s) => s.room_id === form.roomId)
      .map((s) => {
        const p = centralParts(s.starts_at);
        return `${p.date} ${p.time}`;
      }),
  );
  const dates = repeat ? repeatDates(repeat.from, repeat.to, repeat.days) : [];
  const preview = repeat ? (dates ?? []).flatMap((date) => repeat.times.map((time) => ({ date, time, key: `${date} ${time}` }))) : [];
  const toAdd = preview.filter((r) => !taken.has(r.key) && !repeat?.leftOut.includes(r.key));
  const list = toAdd.flatMap((r) => toFields({ ...form, date: r.date, time: r.time }) ?? []);
  const tooMany = toAdd.length > MOST_AT_ONCE;
  const skipped = preview.length - toAdd.length;

  function saveOne() {
    if (!fields) return;
    run(
      async () => {
        const r = await addScreening(fields);
        // Clear the date and time only once it saved, so a failed save can be retried.
        if (r.ok) {
          setDraft((d) => ({
            ...d,
            form: { ...d.form, date: "", time: "" },
            note: { tone: "success", text: `Scheduled ${movieTitle} for ${dayLabel(fields.date)} at ${timeLabel(fields.time)}.` },
          }));
        }
        return r;
      },
      { quiet: true },
    );
  }

  function saveRepeat() {
    if (list.length === 0 || list.length !== toAdd.length || tooMany) return;
    run(
      async () => {
        const r = await addScreenings(list);
        if (r.ok) {
          setDraft((d) => ({
            ...d,
            repeat: d.repeat && { ...d.repeat, from: "", to: "", leftOut: [] },
            note: { tone: "success", text: `Added ${r.added} showing${r.added === 1 ? "" : "s"} of ${movieTitle}.` },
          }));
        }
        return r;
      },
      { quiet: true },
    );
  }

  return (
    <section ref={sectionRef} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">
        Schedule a screening
        <InfoTip topic="screenings-schedule" />
      </h2>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className={`${CHIP} ${!repeat ? "chip-selected" : ""}`} aria-pressed={!repeat} onClick={() => setDraft((d) => ({ ...d, repeat: null }))}>
          One showing
        </button>
        <button className={`${CHIP} ${repeat ? "chip-selected" : ""}`} aria-pressed={!!repeat} onClick={startRepeat}>
          Repeat
        </button>
      </div>
      {note && <p className={note.tone === "success" ? "notice notice-success mb-3 !p-2.5 text-sm" : "mb-3 text-sm text-[var(--muted)]"}>{note.text}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <ScreeningFieldsForm movies={movies} screeningRooms={screeningRooms} value={form} onChange={setForm} withDateTime={!repeat} dateRef={dateRef} />
        {!repeat && (
          <button className="btn-primary min-h-11 text-base" disabled={pending || !fields} onClick={saveOne}>
            {pending ? "Saving…" : "Schedule screening"}
          </button>
        )}
      </div>

      {repeat && (
        <div className="mt-4 space-y-4 rounded-lg border border-dashed border-[var(--border)] p-4">
          <p className="text-sm text-[var(--muted)]">
            Every start time below, on each chosen day, from the first date to the last. Check the list, leave out any you don&apos;t want, then add them all at once.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={LABEL}>First date</label>
              <input type="date" className={INPUT} value={repeat.from} onChange={(e) => setRepeat({ from: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>Last date</label>
              <input type="date" className={INPUT} min={repeat.from || undefined} value={repeat.to} onChange={(e) => setRepeat({ to: e.target.value })} />
            </div>
          </div>
          <div>
            <div className={LABEL}>On these days</div>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((name, i) => {
                const on = repeat.days.includes(i);
                return (
                  <button
                    key={name}
                    className={`${CHIP} ${on ? "chip-selected" : ""}`}
                    aria-pressed={on}
                    onClick={() => setRepeat({ days: on ? repeat.days.filter((d) => d !== i) : [...repeat.days, i] })}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className={LABEL}>Start times (Central)</div>
            <div className="flex flex-wrap items-center gap-2">
              {repeat.times.map((t) => (
                <button key={t} className={`${CHIP} chip-selected`} title="Take this time off the list" onClick={() => setRepeat({ times: repeat.times.filter((x) => x !== t) })}>
                  {timeLabel(t)}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">(remove)</span>
                </button>
              ))}
              <input
                type="time"
                aria-label="Another start time"
                className={INPUT}
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTime()}
              />
              <button className={BUTTON} disabled={!newTime} onClick={addTime}>
                Add time
              </button>
            </div>
          </div>

          {dates === null ? (
            <p className="notice notice-warn !p-2.5 text-sm">That&apos;s more than a year. Check the first and last dates.</p>
          ) : repeat.from && repeat.to && repeat.to < repeat.from ? (
            <p className="notice notice-warn !p-2.5 text-sm">The last date is before the first date.</p>
          ) : preview.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Pick the first and last date, at least one day and at least one start time, and the showings to add are listed here.</p>
          ) : tooMany ? (
            <p className="notice notice-warn !p-2.5 text-sm">
              That&apos;s {toAdd.length} showings. Add at most {MOST_AT_ONCE} at a time: pick a shorter date range or fewer times.
            </p>
          ) : (
            <div>
              <div className="mb-2 text-sm font-medium">
                {toAdd.length} showing{toAdd.length === 1 ? "" : "s"} of {movieTitle} to add
                {skipped > 0 && <span className="font-normal text-[var(--muted)]"> ({skipped} left out)</span>}
              </div>
              <ul className="max-h-96 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
                {preview.map((r) => {
                  const isTaken = taken.has(r.key);
                  const out = repeat.leftOut.includes(r.key);
                  return (
                    <li key={r.key} className="flex min-h-12 items-center gap-3 px-3 py-1">
                      <span className={`min-w-0 flex-1 text-base tabular-nums ${isTaken || out ? "text-[var(--muted)] line-through" : ""}`}>
                        {dayLabel(r.date)} · {timeLabel(r.time)}
                      </span>
                      {isTaken ? (
                        <span className="text-sm text-[var(--muted)]">Already on the schedule in this room</span>
                      ) : (
                        <button
                          className={ROW_BUTTON}
                          onClick={() => setRepeat({ leftOut: out ? repeat.leftOut.filter((k) => k !== r.key) : [...repeat.leftOut, r.key] })}
                        >
                          {out ? "Put back" : "Leave out"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <button className="btn-primary min-h-11 text-base" disabled={pending || list.length === 0 || list.length !== toAdd.length || tooMany} onClick={saveRepeat}>
            {pending ? "Adding…" : `Add ${toAdd.length} showing${toAdd.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {error && (
        <div className="notice notice-warn mt-3 flex items-start gap-2 !p-2.5 text-sm">
          <span className="min-w-0 flex-1">{error}</span>
          <button className="text-xs text-[var(--muted)] underline" onClick={clearError}>
            Close
          </button>
        </div>
      )}
      {screeningRooms.length === 0 && <div className="mt-2 text-sm text-[var(--warn-text)]">No rooms are marked as screening rooms yet.</div>}
    </section>
  );
}

// Movie, when, room, price, seats, then the buttons: Tickets, Duplicate,
// Edit and Remove for a manager, Tickets for anyone else.
const ROW_GRID_EDIT = "grid grid-cols-[1.6fr_1.3fr_1fr_60px_160px_380px] items-center gap-3";
const ROW_GRID_VIEW = "grid grid-cols-[1.6fr_1.3fr_1fr_60px_160px_100px] items-center gap-3";

function UpcomingScreenings({
  screenings,
  tickets,
  movies,
  rooms,
  canEdit,
  onDuplicate,
}: {
  screenings: Screening[];
  tickets: Record<string, TicketCount>;
  movies: Movie[];
  rooms: Room[];
  canEdit: boolean;
  onDuplicate: (s: Screening) => void;
}) {
  const grid = canEdit ? ROW_GRID_EDIT : ROW_GRID_VIEW;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Upcoming screenings</h2>
      {screenings.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">No screenings scheduled yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className={`${canEdit ? "min-w-[1080px]" : "min-w-[760px]"} text-sm`}>
            <div className={`${grid} border-b border-[var(--border)] pb-1.5 text-xs font-medium text-[var(--muted)]`}>
              <span>Movie</span>
              <span>When (Central)</span>
              <span>Room</span>
              <span className="text-right">Price</span>
              <span className="text-right">Seats left · sold/cap</span>
              <span />
            </div>
            <div className="divide-y divide-[var(--border)]">
              {screenings.map((s) => (
                <ScreeningRow
                  key={s.id}
                  screening={s}
                  count={tickets[s.id] ?? NO_TICKETS}
                  movies={movies}
                  rooms={rooms}
                  grid={grid}
                  canEdit={canEdit}
                  onDuplicate={onDuplicate}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ScreeningRow({
  screening: s,
  count,
  movies,
  rooms,
  grid,
  canEdit,
  onDuplicate,
}: {
  screening: Screening;
  count: TicketCount;
  movies: Movie[];
  rooms: Room[];
  grid: string;
  canEdit: boolean;
  onDuplicate: (s: Screening) => void;
}) {
  const [pending, run, error, clearError] = useRefreshingAction();
  const [editing, setEditing] = useState(false);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const full = count.sold >= s.capacity;
  // Seats someone could still buy: a checkout in progress holds its seats.
  const left = Math.max(0, s.capacity - count.sold - count.paying);

  return (
    <div className="py-2">
      <div className={grid}>
        <span className="truncate font-medium" title={s.movie.title}>
          {s.movie.title}
          <VisibilityBadge visibility={visibilityOf(s)} />
          {s.series && <span className="ml-1.5 inline-block rounded-full border border-[var(--border)] px-2 py-0.5 align-middle text-[11px] font-bold">{s.series}</span>}
        </span>
        <span className="text-[var(--muted)]">{when(s.starts_at)}</span>
        <span className="truncate text-[var(--muted)]" title={s.room.name}>
          {s.room.name}
        </span>
        <span className="text-right text-[var(--muted)]">{s.ticket_price === 0 ? "Free" : money(s.ticket_price)}</span>
        <button
          className="min-h-10 text-right tabular-nums hover:underline"
          title={`${left} of ${s.capacity} seats left: ${count.sold} sold${count.paying ? `, ${count.paying} being paid for right now` : ""}. Click for the list.`}
          onClick={() => setTicketsOpen((v) => !v)}
        >
          <span className={`font-semibold ${left === 0 ? "text-[var(--accent)]" : ""}`}>{full ? "Sold out" : `${left} left`}</span>
          <span className="text-[var(--muted)]">
            {" "}
            · {count.sold}/{s.capacity}
          </span>
          {count.paying > 0 && <span className="text-xs text-[var(--muted)]"> +{count.paying}</span>}
        </button>
        <span className="flex flex-wrap justify-end gap-1.5">
          <button className={ROW_BUTTON} onClick={() => setTicketsOpen((v) => !v)}>
            Tickets
          </button>
          {canEdit && (
            <>
              <button className={ROW_BUTTON} title="Put this showing's movie, room, time and price in the scheduler above, to add it on another date" onClick={() => onDuplicate(s)}>
                Duplicate
              </button>
              <button
                className={ROW_BUTTON}
                onClick={() => {
                  clearError();
                  setEditing((v) => !v);
                }}
              >
                Edit
              </button>
              <button
                className="min-h-10 rounded-lg border border-[var(--danger-text)] px-3 text-base text-[var(--danger-text)] disabled:opacity-40"
                disabled={pending}
                title={count.sold > 0 ? "Tickets are sold for this showing. Refund them first, or use Edit to move it." : undefined}
                onClick={() => setConfirmRemove(true)}
              >
                Remove
              </button>
            </>
          )}
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
      {editing && canEdit && <EditScreening screening={s} count={count} movies={movies} rooms={rooms} onDone={() => setEditing(false)} />}
      {ticketsOpen && <TicketsPanel screening={s} />}
      {confirmRemove && (
        <ConfirmModal
          title="Remove this screening?"
          description={`${s.movie.title}, ${when(s.starts_at)}, ${s.room.name}.`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            run(() => deleteScreening(s.id), { quiet: true });
          }}
        />
      )}
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
    visibility: visibilityOf(s),
    series: s.series ?? "",
  });
  // The server's question when tickets are sold (see updateScreening), and
  // the changes it's about.
  const [asking, setAsking] = useState<{ question: string; fields: ScreeningFields } | null>(null);
  const fields = toFields(form);
  const held = count.sold + count.paying;
  const timeChanged = form.date !== start.date || form.time !== start.time;
  const priceChanged = fields !== null && fields.ticket_price !== Number(s.ticket_price);

  function save(changes: ScreeningFields, confirmed = false) {
    run(async () => {
      const r = await updateScreening(s.id, changes, confirmed);
      if (!r.ok && "confirm" in r) {
        setAsking({ question: r.confirm, fields: changes });
        return;
      }
      if (r.ok) onDone();
      return r;
    });
  }

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
        <button className="btn-primary min-h-11 text-base" disabled={pending || !fields} onClick={() => fields && save(fields)}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button className="min-h-11 px-2 text-base text-[var(--muted)] hover:underline" onClick={onDone}>
          Cancel
        </button>
      </div>
      {asking && (
        <ConfirmModal
          title="Tickets are already sold"
          description={asking.question}
          confirmLabel="Save anyway"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const changes = asking.fields;
            setAsking(null);
            save(changes, true);
          }}
        />
      )}
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
