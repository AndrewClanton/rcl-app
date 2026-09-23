"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserFacingError } from "@/lib/errors";
import { searchMovies, getMovieDetails, type OmdbSearchResult } from "@/lib/omdb";
import { getPosterOptionsByImdbId, type PosterOption } from "@/lib/tmdb-posters";

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

export async function searchOmdbMovies(query: string, year?: string): Promise<Result<{ results: OmdbSearchResult[] }>> {
  return attempt(async () => ({ results: query.trim() ? await searchMovies(query.trim(), year) : [] }));
}

// Downloads a poster once and re-hosts it in our own Storage bucket, so the
// live site never depends on a third party's server for it again. Returns
// null (rather than throwing) on any failure -- a broken poster link
// shouldn't block adding the movie to the schedule.
async function downloadAndStorePoster(
  supabase: ReturnType<typeof createAdminClient>,
  key: string,
  posterUrl: string | null
): Promise<string | null> {
  if (!posterUrl) return null;
  try {
    const res = await fetch(posterUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
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

// Imports (or reuses, if already imported) a movie from OMDb (IMDb-sourced
// data) by its IMDb id.
export async function importMovieFromOmdb(imdbId: string): Promise<Result<{ id: string }>> {
  return attempt(async () => {
    const supabase = createAdminClient();
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

// Alternate poster art for a movie already in the library, pulled from TMDb
// by the movie's IMDb id. Empty if the movie has no imdb_id on file (added
// manually) or TMDb has no matching entry.
export async function getPosterOptions(movieId: string): Promise<Result<{ options: PosterOption[] }>> {
  return attempt(async () => {
    const supabase = createAdminClient();
    const { data: movie } = await supabase.from("movies").select("imdb_id").eq("id", movieId).single();
    return { options: movie?.imdb_id ? await getPosterOptionsByImdbId(movie.imdb_id) : [] };
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
