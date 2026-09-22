"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchMovies, getMovieDetails, type OmdbSearchResult } from "@/lib/omdb";

function revalidate() {
  revalidatePath("/admin/screenings");
  revalidatePath("/showtimes");
  revalidatePath("/");
}

export async function searchOmdbMovies(query: string): Promise<OmdbSearchResult[]> {
  if (!query.trim()) return [];
  return searchMovies(query.trim());
}

// Downloads a poster once and re-hosts it in our own Storage bucket, so the
// live site never depends on a third party's server for it again. Returns
// null (rather than throwing) on any failure -- a broken poster link
// shouldn't block adding the movie to the schedule.
async function downloadAndStorePoster(
  supabase: ReturnType<typeof createAdminClient>,
  imdbId: string,
  posterUrl: string | null
): Promise<string | null> {
  if (!posterUrl) return null;
  try {
    const res = await fetch(posterUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${imdbId}.${ext}`;
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
