import "server-only";
import { UserFacingError } from "@/lib/errors";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

function requireApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new UserFacingError(
      "Alternate posters aren't set up on this server: TMDB_API_KEY is missing. Add it in Vercel → Settings → Environment Variables, then redeploy."
    );
  }
  return key;
}

async function tmdbGet(path: string, key: string) {
  let res: Response;
  try {
    res = await fetch(`${TMDB_API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    throw new UserFacingError("Couldn't reach TMDb. Check the connection and try again.");
  }
  if (res.status === 401) throw new UserFacingError("TMDb rejected the API key. Check TMDB_API_KEY in Vercel's environment variables.");
  if (!res.ok) throw new UserFacingError(`TMDb isn't responding right now (HTTP ${res.status}). Try again in a minute.`);
  return res.json();
}

export interface PosterOption {
  url: string;
}

// OMDb only ever returns one poster per movie. TMDb keeps many variants per
// title (different releases, regions, fan submissions), so it's used here
// purely as a secondary source of alternatives to pick from -- looked up by
// IMDb id so it stays in sync with the OMDb-imported movie, not a separate
// search.
export async function getPosterOptionsByImdbId(imdbId: string): Promise<PosterOption[]> {
  const key = requireApiKey();
  const findJson = await tmdbGet(`/find/${imdbId}?external_source=imdb_id`, key);
  const tmdbMovie = findJson.movie_results?.[0];
  if (!tmdbMovie) return [];

  const imagesJson = await tmdbGet(`/movie/${tmdbMovie.id}/images`, key);
  const posters = (imagesJson.posters ?? []) as { file_path: string }[];
  return posters.slice(0, 16).map((p) => ({ url: `${TMDB_IMAGE_BASE}${p.file_path}` }));
}
