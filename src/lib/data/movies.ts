import { createClient } from "@/lib/supabase/server";
import type { Movie } from "@/lib/types";

export async function getMovies(): Promise<Movie[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("movies").select("*").order("title");
  if (error) throw error;
  return data ?? [];
}
