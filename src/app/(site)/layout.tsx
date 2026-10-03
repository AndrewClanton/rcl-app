import SiteChrome from "@/components/site/SiteChrome";

// The public site. The header, footer and structured data live in
// SiteChrome so the site-wide 404 (app/not-found.tsx) can wear them too.
// Nothing here reads the visitor's login: the Insiders+ badge is filled in
// by the browser, so pages without their own per-visitor content can be
// static (About, Privacy) or cached (Menu, Events). Home and Showtimes are
// drawn per request because of the clock, but share one cached copy of the
// schedule's rows (lib/data/screenings.ts).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
