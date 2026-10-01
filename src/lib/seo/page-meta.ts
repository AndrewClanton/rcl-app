import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

// Every public page's <title>, description, canonical and link preview
// (Open Graph for Facebook, iMessage, Slack...; a Twitter card for X), from
// one place. Built on SITE_URL, so moving to the real domain changes one
// constant. A page that sets `openGraph` replaces the root layout's whole
// block, which is why each page goes through here instead of setting a
// title alone: otherwise its preview says "Royale Cinema Lounge" and links
// to the home page.

// The site-wide share card: app/opengraph-image.tsx, a 1200x630 landscape
// card drawn at build time.
export const DEFAULT_SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Royale Cinema Lounge: a dine-in cinema and bar at 715 E Broadway, Joplin, MO, on Route 66",
};

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export function pageMeta({
  title,
  description = SITE_DESCRIPTION,
  path,
  image = DEFAULT_SHARE_IMAGE,
  noindex = false,
}: {
  // The page's own name ("Menu"); the root layout's template adds the site
  // name to the <title>. A `{ absolute }` title is used as-is (the home page).
  title: string | { absolute: string };
  description?: string;
  // The page's own address, without query strings: it's the canonical, so
  // /membership?plan=plus and /membership count as one page.
  path: string;
  // A different preview image, or null to leave it to an opengraph-image
  // file next to the page (the showtime cards).
  image?: typeof DEFAULT_SHARE_IMAGE | null;
  noindex?: boolean;
}): Metadata {
  const fullTitle = typeof title === "string" ? `${title} | ${SITE_NAME}` : title.absolute;
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      ...(image && { images: [image] }),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      ...(image && { images: [image] }),
    },
    ...(noindex && { robots: { index: false, follow: false } }),
  };
}
