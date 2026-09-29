import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Any address the site doesn't have (an old bookmark, a mistyped link)
// lands here, so it gets the friendly 404 in (site)/not-found.tsx with the
// site's header and footer, instead of the bare default page. Every real
// route is more specific than this one, so it only ever catches misses.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function MissingPage() {
  notFound();
}
