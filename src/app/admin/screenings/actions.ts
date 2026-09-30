"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserFacingError } from "@/lib/errors";
import { searchMovies, getMovieDetails } from "@/lib/omdb";
import { getTmdbMovie, hasTmdbKey, searchTmdbMovies } from "@/lib/tmdb";
import { getPosterOptions as tmdbPosterOptions, type PosterOption } from "@/lib/tmdb-posters";
import { highResPosterUrl, isAllowedPosterSource } from "@/lib/posters";
import { centralToIso, shiftDate } from "@/lib/ops/time";
import { getScreeningTickets, getTicketCount, type ScreeningTicket } from "@/lib/data/screenings";

function revalidate() {
  revalidatePath("/admin/screenings");
  revalidatePath("/showtimes");
  revalidatePath("/");
}

// ---------- house events (trivia, comedy, book swap...) for the ramp TV ----------

export async function addHouseEvent(input: { title: string; note: string; date: string; start: string; end: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertStaff();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the event a name." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{1,2}:\d{2}$/.test(input.start)) return { ok: false, error: "Pick a date and start time." };
  const startsAt = centralToIso(input.date, input.start);
  let endsAt: string | null = null;
  if (input.end) {
    if (!/^\d{1,2}:\d{2}$/.test(input.end)) return { ok: false, error: "That end time doesn't look right." };
    endsAt = centralToIso(input.date, input.end);
    // Ends after midnight (a late comedy show): that time on the next date,
    // not 24 hours on, which is an hour off the night the clocks change.
    if (endsAt <= startsAt) endsAt = centralToIso(shiftDate(input.date, 1), input.end);
  }
  const { error } = await createAdminClient().from("house_events").insert({ title, note: input.note.trim() || null, starts_at: startsAt, ends_at: endsAt });
  if (error) return { ok: false, error: "Couldn't save that event. Try again." };
  revalidatePath("/admin/screenings");
  return { ok: true };
}

export async function deleteHouseEvent(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertStaff();
  const { error } = await createAdminClient().from("house_events").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that event. Try again." };
  revalidatePath("/admin/screenings");
  return { ok: true };
}

// Actions the UI needs a readable error from return it instead of throwing:
// production replaces a thrown message with "Minified React error #441".
// Checks the staff session itself, like assertStaff() on the actions below.
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!(await getStaffSession())) return { ok: false, error: "Your staff session has expired. Sign in again." };
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

// A search hit from either database. `id` says which: "tmdb:603" or
// "imdb:tt0133093".
export interface MovieSearchResult {
  id: string;
  title: string;
  year: string;
  posterThumb: string | null;
  overview: string | null;
}

// TMDb when its key is set (better ranking, has brand-new releases), else
// OMDb.
export async function searchMovieDatabase(query: string, year?: string): Promise<Result<{ results: MovieSearchResult[] }>> {
  return attempt(async () => {
    const q = query.trim();
    if (!q) return { results: [] };
    if (hasTmdbKey()) {
      const hits = await searchTmdbMovies(q, year);
      return { results: hits.map((h) => ({ id: `tmdb:${h.tmdbId}`, title: h.title, year: h.year, posterThumb: h.posterThumb, overview: h.overview })) };
    }
    const hits = await searchMovies(q, year);
    return { results: hits.map((h) => ({ id: `imdb:${h.imdbID}`, title: h.title, year: h.year, posterThumb: null, overview: null })) };
  });
}

// Downloads a poster once (as a high-res rendition, see lib/posters) and
// re-hosts it in our own Storage bucket, so the live site never depends on
// a third party's server for it again. Returns null (rather than throwing)
// on any failure -- a broken poster link shouldn't block adding the movie
// to the schedule.
async function downloadAndStorePoster(
  supabase: ReturnType<typeof createAdminClient>,
  key: string,
  posterUrl: string | null
): Promise<string | null> {
  if (!posterUrl || !isAllowedPosterSource(posterUrl)) return null;
  try {
    const res = await fetch(highResPosterUrl(posterUrl));
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${key}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("movie-posters").upload(path, buffer, { contentType, upsert: true });
    if (uploadErr) return null;
    const { data: urlData } = supabase.storage.from("movie-posters").getPublicUrl(path);
    return urlData.publicUrl;
  } catch {
    return null;
  }
}

// Adds a search hit to the movie library (or reuses it if it's already
// there, matched by TMDb or IMDb id), re-hosting its poster.
export async function importMovie(resultId: string): Promise<Result<{ id: string }>> {
  return attempt(async () => {
    const supabase = createAdminClient();
    const [source, rawId] = resultId.split(":");

    if (source === "tmdb") {
      const tmdbId = Number(rawId);
      if (!Number.isInteger(tmdbId)) throw new UserFacingError("That search result is invalid. Search again.");
      const details = await getTmdbMovie(tmdbId);
      const match = details.imdbId ? `tmdb_id.eq.${tmdbId},imdb_id.eq.${details.imdbId}` : `tmdb_id.eq.${tmdbId}`;
      const { data: existing } = await supabase.from("movies").select("id").or(match).limit(1).maybeSingle();
      if (existing) return { id: existing.id as string };
      const posterUrl = await downloadAndStorePoster(supabase, details.imdbId ?? `tmdb-${tmdbId}`, details.posterUrl);
      const { data, error } = await supabase
        .from("movies")
        .insert({
          tmdb_id: tmdbId,
          imdb_id: details.imdbId,
          title: details.title,
          synopsis: details.synopsis,
          poster_url: posterUrl,
          runtime_minutes: details.runtimeMinutes,
          rating: details.rated,
          release_year: details.releaseYear,
        })
        .select("id")
        .single();
      if (error) throw error;
      revalidate();
      return { id: data.id as string };
    }

    if (source !== "imdb" || !rawId) throw new UserFacingError("That search result is invalid. Search again.");
    const imdbId = rawId;
    const { data: existing } = await supabase.from("movies").select("id").eq("imdb_id", imdbId).maybeSingle();
    if (existing) return { id: existing.id as string };

    const details = await getMovieDetails(imdbId);
    const posterUrl = await downloadAndStorePoster(supabase, imdbId, details.posterUrl);

    const { data, error } = await supabase
      .from("movies")
      .insert({
        imdb_id: details.imdbID,
        title: details.title,
        synopsis: details.synopsis,
        poster_url: posterUrl,
        runtime_minutes: details.runtimeMinutes,
        rating: details.rated,
        release_year: details.releaseYear,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidate();
    return { id: data.id as string };
  });
}

// Alternate poster art for a movie already in the library, from TMDb.
// Empty if the movie was added manually (no TMDb or IMDb id) or TMDb has no
// matching entry.
export async function getPosterOptions(movieId: string): Promise<Result<{ options: PosterOption[] }>> {
  return attempt(async () => {
    const supabase = createAdminClient();
    const { data: movie } = await supabase.from("movies").select("tmdb_id, imdb_id").eq("id", movieId).single();
    if (!movie?.tmdb_id && !movie?.imdb_id) return { options: [] };
    return { options: await tmdbPosterOptions({ tmdbId: movie.tmdb_id, imdbId: movie.imdb_id }) };
  });
}

export async function setMoviePoster(movieId: string, posterUrl: string): Promise<Result<object>> {
  return attempt(async () => {
    const supabase = createAdminClient();
    // A timestamped filename (not just movieId) -- otherwise this re-uploads
    // to the exact same path as the poster it's replacing, the public URL
    // never changes, and browsers keep showing the old cached image at that
    // URL even though the file and the DB row were both updated correctly.
    const stored = await downloadAndStorePoster(supabase, `${movieId}-${Date.now()}`, posterUrl);
    if (!stored) throw new UserFacingError("Couldn't download that poster. Try a different one.");
    const { error } = await supabase.from("movies").update({ poster_url: stored }).eq("id", movieId);
    if (error) throw error;
    revalidate();
    return {};
  });
}

export async function addMovieManually(fields: { title: string; synopsis?: string; runtime_minutes?: number; rating?: string }): Promise<Result<object>> {
  return attempt(async () => {
    const title = fields.title.trim();
    if (!title) throw new UserFacingError("Give the movie a title.");
    const { error } = await createAdminClient()
      .from("movies")
      .insert({
        title,
        synopsis: fields.synopsis?.trim() || null,
        runtime_minutes: fields.runtime_minutes ?? null,
        rating: fields.rating?.trim() || null,
      });
    if (error) throw error;
    revalidate();
    return {};
  });
}

// ---------- screenings ----------
// Times are typed as Central wall-clock time ("2026-10-13", "19:00") and
// turned into an instant here, on the server, whichever of CDT/CST applies
// that day. (The form used to build the time in the browser, which is only
// right when the browser happens to be set to Central.)

export interface ScreeningFields {
  movie_id: string;
  room_id: string;
  date: string; // YYYY-MM-DD, Central
  time: string; // HH:MM, Central
  ticket_price: number;
  capacity: number;
}

function checkFields(f: ScreeningFields) {
  if (!f.movie_id) throw new UserFacingError("Pick a movie.");
  if (!f.room_id) throw new UserFacingError("Pick a room.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !/^\d{1,2}:\d{2}$/.test(f.time)) throw new UserFacingError("Pick a date and start time.");
  if (!(Number.isFinite(f.ticket_price) && f.ticket_price >= 0)) throw new UserFacingError("Enter a ticket price of $0.00 or more.");
  if (!(Number.isInteger(f.capacity) && f.capacity > 0)) throw new UserFacingError("Capacity has to be at least 1 seat.");
}

export async function addScreening(fields: ScreeningFields): Promise<Result<object>> {
  return attempt(async () => {
    checkFields(fields);
    const { error } = await createAdminClient()
      .from("screenings")
      .insert({
        movie_id: fields.movie_id,
        room_id: fields.room_id,
        starts_at: centralToIso(fields.date, fields.time),
        ticket_price: fields.ticket_price,
        capacity: fields.capacity,
      });
    if (error) throw error;
    revalidate();
    return {};
  });
}

function tickets(n: number) {
  return `${n} ticket${n === 1 ? "" : "s"}`;
}

// Changes a screening in place, so its bookings (and the seats and money
// they hold) stay with it. Moving the time, or swapping the film, on a
// showing people have bought tickets for comes back once as `confirm`, a
// question for the person; they answer by calling again with
// confirmed = true. Nobody is told automatically, so the question says so.
export async function updateScreening(
  id: string,
  fields: ScreeningFields,
  confirmed = false,
): Promise<Result<object> | { ok: false; error: string; confirm: string }> {
  const result = await attempt(async () => {
    checkFields(fields);
    const supabase = createAdminClient();
    const { data: current, error: readErr } = await supabase.from("screenings").select("starts_at, movie_id").eq("id", id).maybeSingle();
    if (readErr) throw readErr;
    if (!current) throw new UserFacingError("That screening isn't there anymore. It may have been removed.");

    const startsAt = centralToIso(fields.date, fields.time);
    const count = await getTicketCount(id);
    const held = count.sold + count.paying;
    if (fields.capacity < held) {
      throw new UserFacingError(`${tickets(held)} ${held === 1 ? "is" : "are"} already sold or being paid for, so capacity can't go below ${held}.`);
    }

    const timeChanged = Date.parse(startsAt) !== Date.parse(current.starts_at as string);
    const movieChanged = fields.movie_id !== current.movie_id;
    if (held > 0 && (timeChanged || movieChanged) && !confirmed) {
      const what = timeChanged && movieChanged ? "the movie and the time" : timeChanged ? "the time" : "the movie";
      return {
        confirm: `${tickets(held)} ${held === 1 ? "has" : "have"} been sold for this showing. Change ${what} anyway? Ticket holders are NOT told automatically, so let them know (their names are under "Tickets" on this page).`,
      };
    }

    const { error } = await supabase
      .from("screenings")
      .update({ movie_id: fields.movie_id, room_id: fields.room_id, starts_at: startsAt, ticket_price: fields.ticket_price, capacity: fields.capacity })
      .eq("id", id);
    if (error) throw error;
    revalidate();
    revalidatePath(`/showtimes/${id}`);
    return {};
  });
  if (result.ok && "confirm" in result && typeof result.confirm === "string") return { ok: false, error: result.confirm, confirm: result.confirm };
  return result;
}

// Removing a screening used to delete its bookings with it (they cascade
// in the database), paid tickets included, with the money still taken.
// Now it refuses while anyone holds a ticket, and says what to do. The
// database refuses too (migration 20260929210000_keep_sold_tickets.sql),
// in case a ticket sells between this check and the delete.
export async function deleteScreening(id: string): Promise<Result<object>> {
  return attempt(async () => {
    const count = await getTicketCount(id);
    if (count.sold > 0) {
      throw new UserFacingError(
        `${tickets(count.sold)} ${count.sold === 1 ? "is" : "are"} sold for this showing, so it can't be removed. Refund ${count.sold === 1 ? "it" : "them"} first (open "Tickets" on this showing), or use Edit to move it instead.`,
      );
    }
    if (count.paying > 0) {
      throw new UserFacingError(`Someone is paying for ${tickets(count.paying)} to this showing right now. Try again in half an hour, once that checkout has finished or expired.`);
    }
    const { error } = await createAdminClient().from("screenings").delete().eq("id", id);
    // P0001: the database's own check (see above) caught a ticket sold just now.
    if (error?.code === "P0001") throw new UserFacingError("A ticket was just sold for this showing, so it can't be removed. Refund it first, or use Edit to move the showing.");
    if (error) throw error;
    revalidate();
    return {};
  });
}

// The ticket list for one showing (the "Tickets" button).
export async function listScreeningTickets(id: string): Promise<Result<{ tickets: ScreeningTicket[] }>> {
  return attempt(async () => ({ tickets: await getScreeningTickets(id) }));
}
