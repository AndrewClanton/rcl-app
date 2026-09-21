import Image from "next/image";
import Link from "next/link";
import { getPubliclyVisibleScreenings } from "@/lib/data/screenings";
import MoviePoster from "@/components/MoviePoster";

export const dynamic = "force-dynamic";

function formatShowtime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

const DIRECTIONS_URL = "https://www.google.com/maps/search/?api=1&query=715+E+Broadway,+Joplin,+MO+64801";

export default async function HomePage() {
  const screenings = (await getPubliclyVisibleScreenings()).slice(0, 6);

  return (
    <div className="space-y-16">
      <section className="panel overflow-hidden">
        <div className="halftone halftone-hero px-6 py-16 text-center sm:px-12 sm:py-24" style={{ background: "var(--gold)" }}>
          <div className="eyebrow mb-3">Joplin, MO</div>
          <h1 className="font-display mx-auto max-w-3xl text-4xl leading-[1.02] sm:text-6xl" style={{ color: "var(--gold-foreground)" }}>
            Movies, food, and drinks in one place.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-sm font-medium sm:text-base" style={{ color: "var(--gold-foreground)" }}>
            Royale Cinema Lounge is a dine-in cinema and bar. Grab a seat, order off the full menu, and catch a show.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/showtimes" className="btn-primary">
              See showtimes
            </Link>
            <Link href="/menu" className="btn-secondary" style={{ borderColor: "var(--gold-foreground)", color: "var(--gold-foreground)" }}>
              View menu
            </Link>
          </div>
        </div>
        <div className="px-6 py-3 text-center font-mono text-xs tracking-wide" style={{ background: "var(--foreground)", color: "var(--background)" }}>
          715 E BROADWAY, JOPLIN MO · ROUTE 66 · EST. 1920
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="font-display text-2xl">Coming up</h2>
          <Link href="/showtimes" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
            See all showtimes →
          </Link>
        </div>
        {screenings.length === 0 ? (
          <div className="card text-sm text-[var(--muted)]">No screenings scheduled yet — check back soon.</div>
        ) : (
          <div className="grid gap-5 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            {screenings.map((s) => (
              <Link key={s.id} href={`/showtimes/${s.id}`} className="panel relative block bg-[var(--surface)] transition-transform hover:-translate-y-0.5">
                <div className="overflow-hidden rounded-[inherit]">
                  <div className="relative">
                    <MoviePoster posterPath={s.movie.poster_path} title={s.movie.title} sizes="(min-width: 1024px) 260px, (min-width: 640px) 45vw, 90vw" />
                    {s.room.name.toLowerCase().includes("outdoor") && (
                      <span className="stamp-tag stamp-tag-gold absolute top-2 left-2">Outdoor</span>
                    )}
                  </div>
                  <div className="px-3 py-3">
                    <div className="font-display text-lg leading-tight">{s.movie.title}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                      {formatShowtime(s.starts_at)} · {s.room.name}
                    </div>
                  </div>
                </div>
                <span className="stamp-tag stamp-tag-gold absolute -top-3 right-3">{s.ticket_price === 0 ? "Free" : `$${s.ticket_price.toFixed(2)}`}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <div className="eyebrow mb-2">Why a member lounge?</div>
            <h2 className="font-display max-w-2xl text-2xl">
              Not a traditional theater — a members&apos; club for people who love film.
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
              We don&apos;t publish a full public schedule — that&apos;s what lets us bring in a much wider range of films, at a
              lower cost, than a typical theater could justify. Members always know what&apos;s playing.
            </p>
            <a
              href="mailto:info@royalecinemajoplin.com?subject=Screening%20request"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--accent)] hover:underline"
            >
              Request a screening →
            </a>
          </div>
          <div className="relative aspect-[3/2] overflow-hidden rounded-lg border-2 border-[var(--foreground)]">
            <Image
              src="/photos/vhs-shelf-couple.jpg"
              alt="Guests browsing the VHS shelf at Royale Cinema Lounge"
              fill
              sizes="(min-width: 1024px) 480px, 100vw"
              className="object-cover"
            />
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="card">
            <h3 className="font-display text-lg text-[var(--accent)]">Private access</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">Screenings and events exclusive to members — a close-knit community of film fans.</p>
          </div>
          <div className="card">
            <h3 className="font-display text-lg text-[var(--accent)]">Curated programming</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">Timeless classics, groundbreaking independent films, and hidden gems.</p>
          </div>
          <div className="card">
            <h3 className="font-display text-lg text-[var(--accent)]">Comfort &amp; community</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">An intimate setting built for conversation — more living room than megaplex.</p>
          </div>
        </div>
      </section>

      <section>
        <div className="eyebrow mb-2">Become a member</div>
        <h2 className="font-display max-w-xl text-2xl">Skip the day pass. Walk in free, every time.</h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
          Insiders is free to join. Insiders+ members never pay at the door again — one flat monthly rate covers
          unlimited entry to every screening.
        </p>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.4fr] lg:items-stretch">
          <div className="card flex flex-col">
            <div className="text-xs font-bold tracking-wide text-[var(--muted)] uppercase">Insiders</div>
            <div className="font-display mt-1 text-3xl">Free</div>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--muted)]">
              <li>$5 day pass (+$3 new releases)</li>
              <li>Points on every purchase</li>
              <li>Mailing list &amp; weekly updates</li>
            </ul>
            <Link href="/membership" className="btn-secondary mt-5 self-start">
              Join free
            </Link>
          </div>

          <div className="panel panel-accent flex flex-col p-6" style={{ background: "var(--foreground)", color: "var(--background)" }}>
            <span className="stamp-tag stamp-tag-gold self-start">Most popular</span>
            <div className="font-display mt-4 text-3xl">Insiders+</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-display text-5xl" style={{ color: "var(--gold)" }}>
                $15
              </span>
              <span className="text-sm opacity-70">/ month</span>
            </div>
            <ul className="mt-5 flex-1 space-y-2.5 text-sm">
              <li className="flex gap-2">
                <span style={{ color: "var(--gold)" }}>✓</span>
                <span>
                  <strong>Unlimited free entry</strong> — every screening, no ticket cost, ever
                </span>
              </li>
              <li className="flex gap-2">
                <span style={{ color: "var(--gold)" }}>✓</span>
                <span>Faster points on every purchase</span>
              </li>
              <li className="flex gap-2">
                <span style={{ color: "var(--gold)" }}>✓</span>
                <span>Priority access to weekly titles &amp; exclusive events</span>
              </li>
              <li className="flex gap-2">
                <span style={{ color: "var(--gold)" }}>✓</span>
                <span>Concession &amp; merch discounts</span>
              </li>
              <li className="flex gap-2">
                <span style={{ color: "var(--gold)" }}>✓</span>
                <span>2 free booth reservations every month</span>
              </li>
            </ul>
            <Link href="/membership" className="btn-primary mt-5 self-start">
              Join Insiders+
            </Link>
            <div className="mt-3 text-xs opacity-60">Seniors $12/mo · Students $10/mo in person with ID</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="grid gap-6 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div>
            <div className="eyebrow mb-2">Food &amp; drink</div>
            <h2 className="font-display text-xl">A full menu, made for movie night</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Snacks, soft drinks, draft beer, wine from Eagles Landing, and specialty cocktails. Try one of our
              movie-themed coffee bar drinks: City of Stars, Oppenheimer, Titanic.
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <span className="stamp-tag stamp-tag-gold">Now serving</span>
              <span className="stamp-tag stamp-tag-accent">21+</span>
            </div>
            <Link href="/menu" className="btn-secondary mt-5 self-start">
              View our menu
            </Link>
          </div>
          <div className="relative aspect-[3/2] overflow-hidden rounded-lg border-2 border-[var(--foreground)]">
            <Image src="/photos/popcorn-reeses.png" alt="" fill sizes="(min-width: 640px) 400px, 100vw" className="object-cover" />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="grid gap-6 sm:grid-cols-[1fr_1.2fr] sm:items-center">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border-2 border-[var(--foreground)]">
            <Image
              src="/photos/video-lounge.png"
              alt="Royale Cinema Lounge's VHS video lounge, with tapes, posters, and a CRT television"
              fill
              sizes="(min-width: 640px) 360px, 100vw"
              className="object-cover"
            />
          </div>
          <div>
            <div className="eyebrow mb-2">Video lounge</div>
            <h2 className="font-display text-xl">Revisit classics on our VHS archive</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              A haven for film lovers who want to experience the magic of &quot;dead formats.&quot; Members have exclusive access to
              our treasure trove of VHS tapes — curl up in a comfy seat, pop in a cassette, and travel back in time.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="font-display text-2xl">Frequently asked questions</h2>
          <Link href="/about#faq" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
            View all FAQs →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card-flat">
            <div className="font-bold">Why don&apos;t you publish a full public schedule?</div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              It&apos;s what lets us bring in a much wider range of films, at a lower cost, than a typical theater could justify.
              Members always know what&apos;s playing.
            </div>
          </div>
          <div className="card-flat">
            <div className="font-bold">How can I purchase tickets?</div>
            <div className="mt-1 text-sm text-[var(--muted)]">Online through our showtimes page, or at the door, subject to availability.</div>
          </div>
        </div>
      </section>

      <section className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-lg border-2 border-[var(--foreground)] p-5 sm:flex-row sm:items-center">
        <Image src="/photos/lounge-neon.png" alt="" fill sizes="100vw" className="object-cover" />
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(100deg, var(--foreground) 20%, rgba(20,17,12,0.72) 70%)" }} />
        <div className="relative">
          <div className="eyebrow mb-2" style={{ color: "var(--gold)" }}>
            Visit us
          </div>
          <h2 className="font-display text-xl" style={{ color: "var(--background)" }}>
            715 E Broadway, Joplin, MO 64801
          </h2>
          <p className="mt-1 text-sm" style={{ color: "rgba(248,245,236,0.75)" }}>
            One of the oldest buildings in the city, on Historic Route 66 since 1920.
          </p>
        </div>
        <div className="relative flex shrink-0 flex-wrap gap-3">
          <a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Get directions
          </a>
          <a href="tel:+14172814172" className="btn-secondary" style={{ borderColor: "var(--background)", color: "var(--background)" }}>
            Call 417-281-4172
          </a>
        </div>
      </section>
    </div>
  );
}
