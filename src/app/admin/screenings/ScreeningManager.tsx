"use client";

import { useState } from "react";
import type { Movie, Room, Screening } from "@/lib/types";
import type { TmdbSearchResult } from "@/lib/tmdb";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { searchTmdbMovies, importMovieFromTmdb, addMovieManually, addScreening, deleteScreening } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function ScreeningManager({ movies, rooms, screenings }: { movies: Movie[]; rooms: Room[]; screenings: Screening[] }) {
  return (
    <div className="space-y-8">
      <MovieImporter movies={movies} />
      <ScreeningScheduler movies={movies} rooms={rooms} />
      <UpcomingScreenings screenings={screenings} />
    </div>
  );
}

function MovieImporter({ movies }: { movies: Movie[] }) {
  const [pending, run] = useRefreshingAction();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualRuntime, setManualRuntime] = useState("");
  const [manualRating, setManualRating] = useState("");
  const [manualSynopsis, setManualSynopsis] = useState("");

  async function runSearch() {
    setError(null);
    try {
      const res = await searchTmdbMovies(query);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Movies</h2>

      <div className="mb-3 flex gap-2">
        <input
          className="flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
          placeholder="Search TMDb for a movie title..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
        />
        <button className="rounded border border-[var(--border)] px-3 py-1 text-sm " onClick={runSearch}>
          Search
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2 text-sm text-[var(--warn-text)] ">
          {error} You can still add a movie manually below.
        </div>
      )}

      {results.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {results.map((r) => (
            <button
              key={r.id}
              disabled={pending}
              onClick={() => run(() => importMovieFromTmdb(r.id))}
              className="rounded border border-[var(--border)] p-2 text-left text-xs hover:border-[var(--border)] "
            >
              <div className="font-medium">{r.title}</div>
              <div className="text-[var(--muted)]">{r.release_date?.slice(0, 4) || "—"}</div>
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

function ScreeningScheduler({ movies, rooms }: { movies: Movie[]; rooms: Room[] }) {
  const [pending, run] = useRefreshingAction();
  const screeningRooms = rooms.filter((r) => r.is_screening_room);
  const [movieId, setMovieId] = useState("");
  const [roomId, setRoomId] = useState(screeningRooms[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [price, setPrice] = useState("8");
  const [capacity, setCapacity] = useState(String(screeningRooms[0]?.capacity ?? ""));

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
            className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm "
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
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

function UpcomingScreenings({ screenings }: { screenings: Screening[] }) {
  const [pending, run] = useRefreshingAction();
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <h2 className="mb-3 text-lg font-semibold">Upcoming screenings</h2>
      {screenings.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">No screenings scheduled yet.</div>
      ) : (
        <div className="divide-y divide-[var(--border)] ">
          {screenings.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{s.movie.title}</span>
              <span className="text-[var(--muted)]">
                {new Date(s.starts_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <span className="text-[var(--muted)]">{s.room.name}</span>
              <span className="text-[var(--muted)]">{money(s.ticket_price)}</span>
              <span className="text-[var(--muted)]">cap {s.capacity}</span>
              <button
                className="ml-auto rounded border border-[var(--danger-text)] px-2 py-1 text-xs text-[var(--danger-text)] "
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
      )}
    </section>
  );
}
