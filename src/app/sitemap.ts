import type { MetadataRoute } from "next";
import { unstable_rethrow } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { getPubliclyVisibleScreenings } from "@/lib/data/screenings";

// Built per request, like /showtimes: a copy made at deploy time kept listing
// showtimes long after they'd started (those links are 404s now) and never
// listed new ones. The screening rows themselves are cached (see
// getPubliclyVisibleScreenings), so a crawler's visit costs no more than that.
export const dynamic = "force-dynamic";

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
  { url: `${SITE_URL}/showtimes`, changeFrequency: "daily", priority: 0.9 },
  { url: `${SITE_URL}/menu`, changeFrequency: "weekly", priority: 0.7 },
  { url: `${SITE_URL}/membership`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/events`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/booths`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/whats-new`, changeFrequency: "daily", priority: 0.5 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const screenings = await getPubliclyVisibleScreenings();
    const screeningRoutes: MetadataRoute.Sitemap = screenings.map((s) => ({
      url: `${SITE_URL}/showtimes/${s.id}`,
      changeFrequency: "daily",
      priority: 0.8,
    }));
    return [...STATIC_ROUTES, ...screeningRoutes];
  } catch (e) {
    // Next's own signals (rendering per request) pass through.
    unstable_rethrow(e);
    // Don't let a DB hiccup take the whole sitemap down -- static routes still matter.
    return STATIC_ROUTES;
  }
}
