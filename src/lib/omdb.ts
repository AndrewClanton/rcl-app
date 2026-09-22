import "server-only";

const OMDB_API = "https://www.omdbapi.com/";

export interface OmdbSearchResult {
  imdbID: string;
  title: string;
  year: string;
}

export interface OmdbMovieDetails {
  imdbID: string;
  title: string;
  synopsis: string | null;
  posterUrl: string | null;
  runtimeMinutes: number | null;
  rated: string | null;
}

function requireApiKey(): string {
  const key = process.env.OMDB_API_KEY;
  if (!key) throw new Error("OMDB_API_KEY is not set. Add it to .env.local to enable movie search/import.");
  return key;
}

// OMDb uses the literal string "N/A" for any field it doesn't have.
function naToNull(v: string | undefined): string | null {
  return !v || v === "N/A" ? null : v;
}

// A bare title search buries anything with a common title (e.g. "Hope",
// "The Musical") under hundreds of unrelated results -- OMDb's search
// doesn't rank by relevance. Passing a year narrows it down to almost
// always find the right one first.
export async function searchMovies(query: string, year?: string): Promise<OmdbSearchResult[]> {
  const key = requireApiKey();
  const yearParam = year?.trim() ? `&y=${encodeURIComponent(year.trim())}` : "";
  const url = `${OMDB_API}?apikey=${key}&type=movie&s=${encodeURIComponent(query)}${yearParam}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OMDb search failed: ${res.status}`);
  const json = await res.json();
  if (json.Response === "False") {
    // "Movie not found!" is a normal no-results case, not an error worth surfacing.
    if (json.Error === "Movie not found!") return [];
    throw new Error(`OMDb search failed: ${json.Error}`);
  }
  return (json.Search ?? []).map((r: { imdbID: string; Title: string; Year: string }) => ({
    imdbID: r.imdbID,
    title: r.Title,
    year: r.Year,
  }));
}

export async function getMovieDetails(imdbId: string): Promise<OmdbMovieDetails> {
  const key = requireApiKey();
  const url = `${OMDB_API}?apikey=${key}&i=${encodeURIComponent(imdbId)}&plot=full`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OMDb lookup failed: ${res.status}`);
  const json = await res.json();
  if (json.Response === "False") throw new Error(`OMDb lookup failed: ${json.Error}`);

  // "91 min" -> 91; "N/A" -> null.
  const runtimeMatch = /^(\d+)/.exec(json.Runtime ?? "");

  return {
    imdbID: json.imdbID,
    title: json.Title,
    synopsis: naToNull(json.Plot),
    posterUrl: naToNull(json.Poster),
    runtimeMinutes: runtimeMatch ? parseInt(runtimeMatch[1], 10) : null,
    rated: naToNull(json.Rated),
  };
}
