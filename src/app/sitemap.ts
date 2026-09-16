import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { getUpcomingScreenings } from "@/lib/data/screenings";

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
  { url: `${SITE_URL}/showtimes`, changeFrequency: "daily", priority: 0.9 },
  { url: `${SITE_URL}/menu`, changeFrequency: "weekly", priority: 0.7 },
  { url: `${SITE_URL}/membership`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/events`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.6 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const screenings = await getUpcomingScreenings();
    const screeningRoutes: MetadataRoute.Sitemap = screenings.map((s) => ({
      url: `${SITE_URL}/showtimes/${s.id}`,
      changeFrequency: "daily",
      priority: 0.8,
    }));
    return [...STATIC_ROUTES, ...screeningRoutes];
  } catch {
    // Don't let a DB hiccup take the whole sitemap down -- static routes still matter.
    return STATIC_ROUTES;
  }
}
