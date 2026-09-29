import Link from "next/link";
import { SITE_NAME, SITE_URL, THEATER_ADDRESS } from "@/lib/site";
import { LEGAL_PAGES_PUBLISHED } from "@/lib/legal";
import PlusLink from "@/components/PlusLink";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks } from "@/lib/plus-checkout";
import { ColorBar, RegMark, Seal, Sprockets } from "@/components/print";

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "MovieTheater",
  name: SITE_NAME,
  description: "A dine-in cinema, bar, and members' lounge showing independent and repertory film in a historic 1920 building on Route 66.",
  url: SITE_URL,
  telephone: "+1-417-281-4172",
  email: "info@royalecinemajoplin.com",
  priceRange: "$$",
  image: `${SITE_URL}/photos/hero-couple.jpg`,
  address: THEATER_ADDRESS,
};

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Insiders+ members aren't sold Insiders+: they get their badge instead.
  // (No session cookie means no lookup, so visitors cost nothing here.)
  const member = await getSignedInMember();
  const plus = !!member && hasPlusPerks(member);
  return (
    <div className="site flex min-h-full flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <header className="sticky top-0 z-10 border-b-[3px] border-[var(--foreground)] bg-[var(--background)]/95 backdrop-blur">
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
            {plus ? (
              <Link href="/account" className="ctag ctag-yellow !px-2.5 !py-0.5 !text-[11px]" title="You're an Insiders+ member">
                Insiders+ ✓
              </Link>
            ) : (
              <PlusLink className="ctag ctag-red !px-2.5 !py-0.5 !text-[11px] transition-transform hover:rotate-0">Get Insiders+</PlusLink>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
      {/* The colophon: a strip of film sprockets, the est. seal, and the
          press marks. */}
      <footer className="mt-10 border-t-[3px] border-[var(--foreground)]">
        <Sprockets className="mx-4 mt-3" />
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-4 py-8">
          <div className="flex items-center gap-5">
            <Seal>
              Est.
              <br />
              1920
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
          <div className="flex items-center gap-4 text-[rgba(20,17,12,0.62)]" aria-hidden="true">
            <RegMark size={22} />
            <ColorBar codes />
            <span className="spec-code leading-relaxed">
              RCL · Joplin, MO
              <br />
              Printed on Route 66
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
