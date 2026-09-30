import SiteChrome from "@/components/site/SiteChrome";

// The public site. The header, footer and structured data live in
// SiteChrome so the site-wide 404 (app/not-found.tsx) can wear them too.
// Nothing here reads the visitor's login: the Insiders+ badge is filled in
// by the browser, so pages without their own per-visitor content (About,
// Privacy, the listings) can be static or cached.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
