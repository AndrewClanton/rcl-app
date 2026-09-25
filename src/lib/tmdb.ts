import "server-only";
import { UserFacingError } from "@/lib/errors";

// TMDb (themoviedb.org): the movie search for the schedule screen, plus
// alternate poster art. Ranks results by relevance, so common titles
// ("Hope", "The Weight") come up first without needing a year -- OMDb's
// title search can't, and missed brand-new releases entirely.
// TMDB_API_KEY holds TMDb's "API Read Access Token" (a Bearer token).

const TMDB_API = "https://api.themoviedb.org/3";

export function hasTmdbKey() {
  return !!process.env.TMDB_API_KEY;
}

export async function tmdbGet(path: string, missingKeyMessage: string) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new UserFacingError(missingKeyMessage);
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

const NO_KEY = "Movie search isn't set up on this server: TMDB_API_KEY is missing. Add it in Vercel → Settings → Environment Variables, then redeploy.";

export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  year: string;
  posterThumb: string | null;
  overview: string | null;
}

export async function searchTmdbMovies(query: string, year?: string): Promise<TmdbSearchResult[]> {
  const y = year?.trim() && /^\d{4}$/.test(year.trim()) ? `&primary_release_year=${year.trim()}` : "";
  const json = await tmdbGet(`/search/movie?include_adult=false&query=${encodeURIComponent(query)}${y}`, NO_KEY);
  return ((json.results ?? []) as { id: number; title: string; release_date?: string; poster_path?: string | null; overview?: string }[])
    .slice(0, 12)
    .map((m) => ({
      tmdbId: m.id,
      title: m.title,
      year: (m.release_date ?? "").slice(0, 4),
      posterThumb: m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : null,
      overview: m.overview || null,
    }));
}

export interface TmdbMovieDetails {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  synopsis: string | null;
  posterUrl: string | null;
  runtimeMinutes: number | null;
  rated: string | null;
  releaseYear: number | null;
}

export async function getTmdbMovie(tmdbId: number): Promise<TmdbMovieDetails> {
  const d = await tmdbGet(`/movie/${tmdbId}?append_to_response=external_ids,release_dates`, NO_KEY);
  // The US theatrical certification (G, PG, PG-13, R...), if TMDb has one.
  const us = (d.release_dates?.results ?? []).find((r: { iso_3166_1: string }) => r.iso_3166_1 === "US");
  const rated = (us?.release_dates ?? []).map((r: { certification: string }) => r.certification).find((c: string) => !!c) ?? null;
  return {
    tmdbId: d.id,
    imdbId: d.external_ids?.imdb_id || d.imdb_id || null,
    title: d.title,
    synopsis: d.overview || null,
    posterUrl: d.poster_path ? `https://image.tmdb.org/t/p/w780${d.poster_path}` : null,
    runtimeMinutes: d.runtime || null,
    rated,
    releaseYear: d.release_date ? Number(d.release_date.slice(0, 4)) : null,
  };
}
