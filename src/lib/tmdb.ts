import "server-only";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

export interface TmdbSearchResult {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date: string;
}

export interface TmdbMovieDetails extends TmdbSearchResult {
  runtime: number | null;
  // US theatrical certification (e.g. "PG-13"), best-effort.
  rating: string | null;
}

function requireApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set. Add it to .env.local to enable TMDb search/import.");
  return key;
}

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
  const key = requireApiKey();
  const url = `${TMDB_API}/search/movie?query=${encodeURIComponent(query)}&include_adult=false`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`TMDb search failed: ${res.status}`);
  const json = await res.json();
  return json.results ?? [];
}

export async function getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
  const key = requireApiKey();
  const [detailsRes, releaseDatesRes] = await Promise.all([
    fetch(`${TMDB_API}/movie/${tmdbId}`, { headers: { Authorization: `Bearer ${key}` } }),
    fetch(`${TMDB_API}/movie/${tmdbId}/release_dates`, { headers: { Authorization: `Bearer ${key}` } }),
  ]);
  if (!detailsRes.ok) throw new Error(`TMDb movie lookup failed: ${detailsRes.status}`);
  const details = await detailsRes.json();

  let rating: string | null = null;
  if (releaseDatesRes.ok) {
    const releaseJson = await releaseDatesRes.json();
    const us = releaseJson.results?.find((r: { iso_3166_1: string }) => r.iso_3166_1 === "US");
    rating = us?.release_dates?.find((d: { certification: string }) => d.certification)?.certification || null;
  }

  return {
    id: details.id,
    title: details.title,
    overview: details.overview,
    poster_path: details.poster_path,
    release_date: details.release_date,
    runtime: details.runtime ?? null,
    rating,
  };
}

export function tmdbPosterUrl(posterPath: string | null): string | null {
  return posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : null;
}
