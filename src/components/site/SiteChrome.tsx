import Link from "next/link";
import { LEGAL_PAGES_PUBLISHED } from "@/lib/legal";
import PlusLink from "@/components/PlusLink";
import { ColorBar, Seal, Sprockets } from "@/components/print";
import { jsonLdScript } from "@/lib/seo/screening-events";
import { theaterJsonLd } from "@/lib/seo/theater";
import SiteHeaderSync from "./SiteHeaderSync";
import { PLUS_HINT_SCRIPT } from "./plus-hint";

// The public site's frame: the sticky header, the page, the colophon footer,
// and the theater's structured data. Used by the (site) layout and by the
// site-wide 404 (app/not-found.tsx), which renders outside that layout.
//
// Reads nothing about the visitor, so every page inside can be static or
// cached. The Insiders+ badge swaps in on the visitor's own browser (see
// components/site/plus-hint.ts).
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    // data-plus is set by the script below before hydration, so React is
    // told not to expect it.
    <div className="site flex min-h-full flex-col" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: PLUS_HINT_SCRIPT }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(theaterJsonLd()) }} />
      <header className="sticky top-0 z-10 border-b-[3px] border-[var(--foreground)] bg-[var(--background)]/95 backdrop-blur">
        {/* Tighter on a phone, where the nav wraps to three rows and the
            header stays on screen the whole time. */}
        <div className="mx-auto max-w-5xl px-4 py-3 text-center sm:py-5">
          <Link href="/" className="font-display inline-block text-2xl sm:text-3xl">
            ROYALE CINEMA LOUNGE
          </Link>
          <nav className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-bold text-[var(--muted)] sm:mt-3">
            <Link href="/showtimes" className="transition-colors hover:text-[var(--accent)]">
              Showtimes
            </Link>
            <Link href="/booths" className="transition-colors hover:text-[var(--accent)]">
              Reserve a Booth
            </Link>
            <Link href="/menu" className="transition-colors hover:text-[var(--accent)]">
              Menu
            </Link>
            <Link href="/events" className="transition-colors hover:text-[var(--accent)]">
              Private events
            </Link>
            <Link href="/membership" className="transition-colors hover:text-[var(--accent)]">
              Insiders
            </Link>
            <Link href="/about" className="transition-colors hover:text-[var(--accent)]">
              About
            </Link>
            <Link href="/account" className="transition-colors hover:text-[var(--accent)]">
              My Account
            </Link>
            {/* Insiders+ members aren't sold Insiders+: they get their badge instead. */}
            <Link href="/account" className="plus-show ctag ctag-yellow !px-2.5 !py-0.5 !text-[11px]" title="You're an Insiders+ member">
              Insiders+ ✓
            </Link>
            <PlusLink className="plus-hide ctag ctag-red !px-2.5 !py-0.5 !text-[11px] transition-transform hover:rotate-0">Get Insiders+</PlusLink>
          </nav>
          <SiteHeaderSync />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
      {/* The colophon: a strip of film sprockets, the est. seal, and the
          press marks. */}
      <footer className="mt-10 border-t-[3px] border-[var(--foreground)]">
        <Sprockets className="mx-4 mt-3" />
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-4 py-8">
          <div className="flex items-center gap-5">
            {/* No founding date: 1920 is the building, not the theater. */}
            <Seal>
              Joplin
              <br />
              Route 66
            </Seal>
            <div className="text-sm">
              <div className="font-display text-base">Royale Cinema Lounge</div>
              <div className="text-[var(--muted)]">715 E Broadway, Joplin, MO 64801</div>
              <div className="mt-1">
                <a href="tel:+14172814172" className="font-bold hover:text-[var(--accent)]">
                  417-281-4172
                </a>
                {" · "}
                <a href="mailto:info@royalecinemajoplin.com" className="font-bold hover:text-[var(--accent)]">
                  info@royalecinemajoplin.com
                </a>
              </div>
              {LEGAL_PAGES_PUBLISHED && (
                <div className="mt-1 text-[var(--muted)]">
                  <Link href="/privacy" className="hover:text-[var(--accent)]">
                    Privacy policy
                  </Link>
                  {" · "}
                  <Link href="/data-deletion" className="hover:text-[var(--accent)]">
                    Deleting your data
                  </Link>
                </div>
              )}
            </div>
          </div>
          <ColorBar size={14} />
        </div>
      </footer>
    </div>
  );
}
