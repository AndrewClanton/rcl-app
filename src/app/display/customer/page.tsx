import { requireStaff } from "@/lib/auth";
import { getPubliclyVisibleScreenings } from "@/lib/data/screenings";
import { tmdbPosterUrl } from "@/lib/tmdb";
import CustomerDisplay from "./CustomerDisplay";

export const dynamic = "force-dynamic";

export default async function CustomerDisplayPage() {
  await requireStaff();
  const screenings = await getPubliclyVisibleScreenings();

  // tmdbPosterUrl lives in a server-only module, so poster URLs are
  // resolved here (a Server Component) rather than in CustomerDisplay
  // ("use client"), which can't import anything marked server-only.
  const seen = new Set<string>();
  const movies: { title: string; posterUrl: string | null; nextShowtime: string }[] = [];
  for (const s of screenings) {
    if (seen.has(s.movie.title)) continue;
    seen.add(s.movie.title);
    movies.push({ title: s.movie.title, posterUrl: tmdbPosterUrl(s.movie.poster_path), nextShowtime: s.starts_at });
    if (movies.length >= 8) break;
  }

  return <CustomerDisplay movies={movies} />;
}
