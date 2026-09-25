import "server-only";
import { tmdbGet } from "@/lib/tmdb";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const NO_KEY = "Alternate posters aren't set up on this server: TMDB_API_KEY is missing. Add it in Vercel → Settings → Environment Variables, then redeploy.";

export interface PosterOption {
  url: string;
}

// TMDb keeps many poster variants per title (different releases, regions,
// fan submissions) to pick from. Looked up by TMDb id when the movie has one,
// else by its IMDb id.
export async function getPosterOptions(ids: { tmdbId: number | null; imdbId: string | null }): Promise<PosterOption[]> {
  let tmdbId = ids.tmdbId;
  if (!tmdbId && ids.imdbId) {
    const findJson = await tmdbGet(`/find/${ids.imdbId}?external_source=imdb_id`, NO_KEY);
    tmdbId = findJson.movie_results?.[0]?.id ?? null;
  }
  if (!tmdbId) return [];

  const imagesJson = await tmdbGet(`/movie/${tmdbId}/images`, NO_KEY);
  const posters = (imagesJson.posters ?? []) as { file_path: string }[];
  return posters.slice(0, 16).map((p) => ({ url: `${TMDB_IMAGE_BASE}${p.file_path}` }));
}
