"use client";

import { useState } from "react";
import type { Movie, Room, Screening } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { PosterOption } from "@/lib/tmdb-posters";
import { searchMovieDatabase, importMovie, getPosterOptions, setMoviePoster, addMovieManually, addScreening, deleteScreening, type MovieSearchResult } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function ScreeningManager({ movies, rooms, screenings }: { movies: Movie[]; rooms: Room[]; screenings: Screening[] }) {
  return (
    <div className="space-y-8">
      <MovieImporter movies={movies} />
      <MovieLibrary movies={movies} />
      <ScreeningScheduler movies={movies} rooms={rooms} />
      <UpcomingScreenings screenings={screenings} />
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
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8">
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

function ScreeningScheduler({ movies, rooms }: { movies: Movie[]; rooms: Room[] }) {
  const [pending, run] = useRefreshingAction();
  const screeningRooms = rooms.filter((r) => r.is_screening_room);
  const initialRoom = screeningRooms[0];
  const [movieId, setMovieId] = useState("");
  const [roomId, setRoomId] = useState(initialRoom?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [price, setPrice] = useState(isOutdoorRoom(initialRoom) ? "0" : "8");
  const [capacity, setCapacity] = useState(String(initialRoom?.capacity ?? ""));

  const selectedRoom = screeningRooms.find((r) => r.id === roomId);
  const outdoor = isOutdoorRoom(selectedRoom);

  const canSubmit = movieId && roomId && date && time && parseFloat(price) >= 0 && parseInt(capacity, 10) > 0;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Schedule a screening</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Movie</label>
          <select
            className="rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={movieId}
            onChange={(e) => setMovieId(e.target.value)}
          >
            <option value="">Select a movie...</option>
            {movies.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Room</label>
          <select
            className="rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value);
              const r = screeningRooms.find((r) => r.id === e.target.value);
              if (r) setCapacity(String(r.capacity));
              if (isOutdoorRoom(r)) setPrice("0");
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
          <label className="mb-1 block text-xs text-[var(--muted)]">Date</label>
          <input
            type="date"
            className="rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Time</label>
          <input
            type="time"
            className="rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Ticket price</label>
          <input
            type="number"
            step="0.01"
            min="0"
            disabled={outdoor}
            className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm disabled:opacity-50 "
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {outdoor && <div className="mt-0.5 text-[10px] text-[var(--muted)]">Free — sponsored by the Royale Cinema Project</div>}
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Capacity</label>
          <input
            type="number"
            min="1"
            className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
        <button
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50 "
          disabled={pending || !canSubmit}
          onClick={() => {
            const fields = {
              movie_id: movieId,
              room_id: roomId,
              starts_at: new Date(`${date}T${time}`).toISOString(),
              ticket_price: parseFloat(price),
              capacity: parseInt(capacity, 10),
            };
            setDate("");
            setTime("");
            run(() => addScreening(fields));
          }}
        >
          Schedule screening
        </button>
      </div>
      {screeningRooms.length === 0 && <div className="mt-2 text-sm text-[var(--warn-text)]">No rooms are marked as screening rooms yet.</div>}
    </section>
  );
}

const SCREENING_ROW_GRID = "grid grid-cols-[1.6fr_1.3fr_1fr_60px_56px_72px] items-center gap-3";

function UpcomingScreenings({ screenings }: { screenings: Screening[] }) {
  const [pending, run] = useRefreshingAction();
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Upcoming screenings</h2>
      {screenings.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">No screenings scheduled yet.</div>
      ) : (
        <div className="min-w-[560px] overflow-x-auto text-sm">
          <div className={`${SCREENING_ROW_GRID} border-b border-[var(--border)] pb-1.5 text-xs font-medium text-[var(--muted)]`}>
            <span>Movie</span>
            <span>When</span>
            <span>Room</span>
            <span className="text-right">Price</span>
            <span className="text-right">Cap</span>
            <span />
          </div>
          <div className="divide-y divide-[var(--border)]">
            {screenings.map((s) => (
              <div key={s.id} className={`${SCREENING_ROW_GRID} py-2`}>
                <span className="truncate font-medium" title={s.movie.title}>
                  {s.movie.title}
                </span>
                <span className="text-[var(--muted)]">
                  {new Date(s.starts_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="truncate text-[var(--muted)]" title={s.room.name}>
                  {s.room.name}
                </span>
                <span className="text-right text-[var(--muted)]">{s.ticket_price === 0 ? "Free" : money(s.ticket_price)}</span>
                <span className="text-right text-[var(--muted)]">{s.capacity}</span>
                <button
                  className="justify-self-end rounded border border-[var(--danger-text)] px-2 py-1 text-xs text-[var(--danger-text)] "
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove this screening of "${s.movie.title}"?`)) run(() => deleteScreening(s.id));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
