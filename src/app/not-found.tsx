import type { Metadata } from "next";
import SiteChrome from "@/components/site/SiteChrome";
import NotFoundSheet from "@/components/site/NotFoundSheet";

// The site-wide 404, for any address no route matches: mistyped links, old
// bookmarks, and (rewritten by the proxy, see lib/showtime-gate.ts) showtime
// links whose show has started or come off the schedule.
//
// Prerendered at build, so it's served whole, header and footer included,
// with a 404 status. It replaces the old (site)/[...missing] catch-all,
// which rendered the same page by throwing notFound() mid-render, and that
// only ever reached the browser as an empty shell that JavaScript filled in.
// Next adds the noindex tag to 404 pages itself.
export const metadata: Metadata = {
  title: "Page not found",
  description: "We couldn't find that page. See what's playing at Royale Cinema Lounge in Joplin, MO.",
};

export default function NotFound() {
  return (
    <SiteChrome>
      <NotFoundSheet />
    </SiteChrome>
  );
}
