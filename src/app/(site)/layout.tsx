import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import { LEGAL_PAGES_PUBLISHED } from "@/lib/legal";

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "MovieTheater",
  name: "Royale Cinema Lounge",
  description: "A dine-in cinema, bar, and members' lounge showing independent and repertory film in a historic 1920 building on Route 66.",
  url: SITE_URL,
  telephone: "+1-417-281-4172",
  email: "info@royalecinemajoplin.com",
  priceRange: "$$",
  image: `${SITE_URL}/photos/hero-couple.jpg`,
  address: {
    "@type": "PostalAddress",
    streetAddress: "715 E Broadway",
    addressLocality: "Joplin",
    addressRegion: "MO",
    postalCode: "64801",
    addressCountry: "US",
  },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <header className="sticky top-0 z-10 border-b-2 border-[var(--foreground)] bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-5 text-center">
          <Link href="/" className="font-display inline-block text-2xl sm:text-3xl">
            ROYALE CINEMA LOUNGE
          </Link>
          <nav className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-bold text-[var(--muted)]">
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
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted)]">
        <div>Royale Cinema Lounge — 715 E Broadway, Joplin, MO 64801</div>
        <div className="mt-1">
          <a href="tel:+14172814172" className="hover:text-[var(--accent)]">
            417-281-4172
          </a>
          {" · "}
          <a href="mailto:info@royalecinemajoplin.com" className="hover:text-[var(--accent)]">
            info@royalecinemajoplin.com
          </a>
        </div>
        {LEGAL_PAGES_PUBLISHED && (
          <div className="mt-1">
            <Link href="/privacy" className="hover:text-[var(--accent)]">
              Privacy policy
            </Link>
            {" · "}
            <Link href="/data-deletion" className="hover:text-[var(--accent)]">
              Deleting your data
            </Link>
          </div>
        )}
      </footer>
    </div>
  );
}
