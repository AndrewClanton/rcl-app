"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserFacingError } from "@/lib/errors";
import { searchMovies, getMovieDetails } from "@/lib/omdb";
import { getTmdbMovie, hasTmdbKey, searchTmdbMovies } from "@/lib/tmdb";
import { getPosterOptions as tmdbPosterOptions, type PosterOption } from "@/lib/tmdb-posters";
import { highResPosterUrl, isAllowedPosterSource } from "@/lib/posters";

function revalidate() {
  revalidatePath("/admin/screenings");
  revalidatePath("/showtimes");
  revalidatePath("/");
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

export async function addMovieManually(fields: { title: string; synopsis?: string; runtime_minutes?: number; rating?: string }) {
  await assertStaff();
  const title = fields.title.trim();
  if (!title) return;
  const supabase = createAdminClient();
  await supabase.from("movies").insert({
    title,
    synopsis: fields.synopsis?.trim() || null,
    runtime_minutes: fields.runtime_minutes ?? null,
    rating: fields.rating?.trim() || null,
  });
  revalidate();
}

export async function addScreening(fields: { movie_id: string; room_id: string; starts_at: string; ticket_price: number; capacity: number }) {
  await assertStaff();
  const supabase = createAdminClient();
  const { error } = await supabase.from("screenings").insert(fields);
  if (error) throw error;
  revalidate();
}

export async function deleteScreening(id: string) {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase.from("screenings").delete().eq("id", id);
  revalidate();
}
