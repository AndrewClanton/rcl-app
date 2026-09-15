"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchMovies, getMovieDetails, type TmdbSearchResult } from "@/lib/tmdb";

function revalidate() {
  revalidatePath("/admin/screenings");
  revalidatePath("/showtimes");
  revalidatePath("/");
}

export async function searchTmdbMovies(query: string): Promise<TmdbSearchResult[]> {
  if (!query.trim()) return [];
  return searchMovies(query.trim());
}

// Imports (or reuses, if already imported) a movie from TMDb by its id.
export async function importMovieFromTmdb(tmdbId: number): Promise<string> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("movies").select("id").eq("tmdb_id", tmdbId).maybeSingle();
  if (existing) return existing.id;

  const details = await getMovieDetails(tmdbId);
  const { data, error } = await supabase
    .from("movies")
    .insert({
      tmdb_id: details.id,
      title: details.title,
      synopsis: details.overview,
      poster_path: details.poster_path,
      runtime_minutes: details.runtime,
      rating: details.rating,
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
