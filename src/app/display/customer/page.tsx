import { requireDisplayScreen } from "@/lib/auth";
import { getPubliclyVisibleScreenings } from "@/lib/data/screenings";
import CustomerDisplay from "./CustomerDisplay";
import { registerTopic } from "@/lib/register-topic";
import { deploymentId } from "@/lib/deployment";

export const dynamic = "force-dynamic";

// The tablet facing the customer at the register. Runs on its own
// display-only login (Staff page, role "Display screen"), which can't open
// the back office or the register; a staff login works here too.
export default async function CustomerDisplayPage() {
  await requireDisplayScreen("/display/customer");
  const screenings = await getPubliclyVisibleScreenings();

  const seen = new Set<string>();
  const movies: { title: string; posterUrl: string | null; nextShowtime: string }[] = [];
  for (const s of screenings) {
    if (seen.has(s.movie.title)) continue;
    seen.add(s.movie.title);
    movies.push({ title: s.movie.title, posterUrl: s.movie.poster_url, nextShowtime: s.starts_at });
    if (movies.length >= 8) break;
  }

  return <CustomerDisplay movies={movies} registerTopic={registerTopic()} version={deploymentId()} />;
}
