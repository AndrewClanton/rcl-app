import "server-only";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

function requireApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set. Add it to .env.local to enable alternate poster options.");
  return key;
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
  const findRes = await fetch(`${TMDB_API}/find/${imdbId}?external_source=imdb_id`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!findRes.ok) throw new Error(`TMDb lookup failed: ${findRes.status}`);
  const findJson = await findRes.json();
  const tmdbMovie = findJson.movie_results?.[0];
  if (!tmdbMovie) return [];

  const imagesRes = await fetch(`${TMDB_API}/movie/${tmdbMovie.id}/images`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!imagesRes.ok) throw new Error(`TMDb images failed: ${imagesRes.status}`);
  const imagesJson = await imagesRes.json();
  const posters = (imagesJson.posters ?? []) as { file_path: string }[];
  return posters.slice(0, 16).map((p) => ({ url: `${TMDB_IMAGE_BASE}${p.file_path}` }));
}
