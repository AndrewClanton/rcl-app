import "server-only";
import { UserFacingError } from "@/lib/errors";

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
  releaseYear: number | null;
}

function requireApiKey(): string {
  const key = process.env.OMDB_API_KEY;
  if (!key) {
    throw new UserFacingError(
      "Movie search isn't set up on this server: OMDB_API_KEY is missing. Add it in Vercel → Settings → Environment Variables, then redeploy."
    );
  }
  return key;
}

// OMDb uses the literal string "N/A" for any field it doesn't have.
function naToNull(v: string | undefined): string | null {
  return !v || v === "N/A" ? null : v;
}

async function omdbGet(params: string): Promise<Record<string, unknown>> {
  const key = requireApiKey();
  let res: Response;
  try {
    res = await fetch(`${OMDB_API}?apikey=${key}&${params}`);
  } catch {
    throw new UserFacingError("Couldn't reach OMDb. Check the connection and try again.");
  }
  if (!res.ok) throw new UserFacingError(`OMDb isn't responding right now (HTTP ${res.status}). Try again in a minute.`);
  const json = await res.json();
  if (json.Response === "False" && json.Error !== "Movie not found!") {
    const error = String(json.Error ?? "");
    if (error === "Invalid API key!") throw new UserFacingError("OMDb rejected the API key. Check OMDB_API_KEY in Vercel's environment variables.");
    if (error === "Too many results.") throw new UserFacingError("Too many matches. Type more of the title, or add a year.");
    if (error === "Request limit reached!") throw new UserFacingError("Hit OMDb's daily limit (1,000 lookups on the free key). Try again tomorrow, or add the movie manually.");
    throw new UserFacingError(`OMDb: ${error || "unknown error"}`);
  }
  return json;
}

// A bare title search buries anything with a common title (e.g. "Hope",
// "The Musical") under hundreds of unrelated results -- OMDb's search
// doesn't rank by relevance. Passing a year narrows it down to almost
// always find the right one first.
export async function searchMovies(query: string, year?: string): Promise<OmdbSearchResult[]> {
  const yearParam = year?.trim() ? `&y=${encodeURIComponent(year.trim())}` : "";
  const json = await omdbGet(`type=movie&s=${encodeURIComponent(query)}${yearParam}`);
  // "Movie not found!" is a normal no-results case, not an error.
  if (json.Response === "False") return [];
  return ((json.Search ?? []) as { imdbID: string; Title: string; Year: string }[]).map((r) => ({
    imdbID: r.imdbID,
    title: r.Title,
    year: r.Year,
  }));
}

export async function getMovieDetails(imdbId: string): Promise<OmdbMovieDetails> {
  const json = (await omdbGet(`i=${encodeURIComponent(imdbId)}&plot=full`)) as Record<string, string | undefined>;
  if (json.Response === "False") throw new UserFacingError("OMDb couldn't find that movie anymore. Search again.");

  // "91 min" -> 91; "N/A" -> null.
  const runtimeMatch = /^(\d+)/.exec(json.Runtime ?? "");
  // "2026" -> 2026; "N/A" -> null. (Not expecting the "2019–2023"-style
  // range OMDb uses for series -- this is always queried with type=movie.)
  const yearMatch = /^(\d{4})/.exec(json.Year ?? "");

  return {
    imdbID: json.imdbID ?? imdbId,
    title: json.Title ?? "",
    synopsis: naToNull(json.Plot),
    posterUrl: naToNull(json.Poster),
    runtimeMinutes: runtimeMatch ? parseInt(runtimeMatch[1], 10) : null,
    rated: naToNull(json.Rated),
    releaseYear: yearMatch ? parseInt(yearMatch[1], 10) : null,
  };
}
