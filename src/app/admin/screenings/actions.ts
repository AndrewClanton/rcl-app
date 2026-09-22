"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchMovies, getMovieDetails, type OmdbSearchResult } from "@/lib/omdb";
import { getPosterOptionsByImdbId, type PosterOption } from "@/lib/tmdb-posters";

function revalidate() {
  revalidatePath("/admin/screenings");
  revalidatePath("/showtimes");
  revalidatePath("/");
}

export async function searchOmdbMovies(query: string, year?: string): Promise<OmdbSearchResult[]> {
  if (!query.trim()) return [];
  return searchMovies(query.trim(), year);
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
export async function importMovieFromOmdb(imdbId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("movies").select("id").eq("imdb_id", imdbId).maybeSingle();
  if (existing) return existing.id;

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
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidate();
  return data.id;
}

// Alternate poster art for a movie already in the library, pulled from TMDb
// by the movie's IMDb id. Empty if the movie has no imdb_id on file (added
// manually) or TMDb has no matching entry.
export async function getPosterOptions(movieId: string): Promise<PosterOption[]> {
  const supabase = createAdminClient();
  const { data: movie } = await supabase.from("movies").select("imdb_id").eq("id", movieId).single();
  if (!movie?.imdb_id) return [];
  return getPosterOptionsByImdbId(movie.imdb_id);
}

export async function setMoviePoster(movieId: string, posterUrl: string): Promise<void> {
  const supabase = createAdminClient();
  // A timestamped filename (not just movieId) -- otherwise this re-uploads
  // to the exact same path as the poster it's replacing, the public URL
  // never changes, and browsers keep showing the old cached image at that
  // URL even though the file and the DB row were both updated correctly.
  const stored = await downloadAndStorePoster(supabase, `${movieId}-${Date.now()}`, posterUrl);
  if (!stored) throw new Error("Could not download that poster. Try a different one.");
  const { error } = await supabase.from("movies").update({ poster_url: stored }).eq("id", movieId);
  if (error) throw error;
  revalidate();
}

export async function addMovieManually(fields: { title: string; synopsis?: string; runtime_minutes?: number; rating?: string }) {
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
  const supabase = createAdminClient();
  const { error } = await supabase.from("screenings").insert(fields);
  if (error) throw error;
  revalidate();
}

export async function deleteScreening(id: string) {
  const supabase = createAdminClient();
  await supabase.from("screenings").delete().eq("id", id);
  revalidate();
}
