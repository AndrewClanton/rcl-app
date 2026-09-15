import Link from "next/link";
import { getUpcomingScreenings } from "@/lib/data/screenings";
import MoviePoster from "@/components/MoviePoster";

export const dynamic = "force-dynamic";

function formatShowtime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const DIRECTIONS_URL = "https://www.google.com/maps/search/?api=1&query=715+E+Broadway,+Joplin,+MO+64801";

export default async function HomePage() {
  const screenings = (await getUpcomingScreenings()).slice(0, 6);

  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border)] p-8 sm:p-12">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 80% at 20% 0%, var(--accent-soft), transparent), linear-gradient(160deg, var(--surface), var(--background))",
          }}
        />
        <div className="eyebrow mb-3">Joplin, MO</div>
        <h1 className="font-display max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
          Movies, food, and drinks in one place.
        </h1>
        <p className="mt-4 max-w-xl text-[var(--muted)]">
          Royale Cinema Lounge is a dine-in cinema and bar. Grab a seat, order off the full menu, and catch a show.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/showtimes" className="btn-primary">
            See showtimes
          </Link>
          <Link href="/menu" className="btn-secondary">
            View menu
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold">Coming up</h2>
          <Link href="/showtimes" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
            See all showtimes →
          </Link>
        </div>
        {screenings.length === 0 ? (
          <div className="card text-sm text-[var(--muted)]">No screenings scheduled yet — check back soon.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {screenings.map((s) => (
              <Link key={s.id} href={`/showtimes/${s.id}`} className="card-flat !p-3">
                <MoviePoster posterPath={s.movie.poster_path} title={s.movie.title} sizes="(min-width: 1024px) 260px, (min-width: 640px) 45vw, 90vw" />
                <div className="mt-3 px-1">
                  <div className="font-medium">{s.movie.title}</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">{formatShowtime(s.starts_at)}</div>
                  <div className="text-sm text-[var(--muted)]">{s.room.name}</div>
                  <div className="mt-2 text-sm font-semibold text-[var(--accent)]">${s.ticket_price.toFixed(2)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="eyebrow mb-2">Why a member lounge?</div>
        <h2 className="font-display max-w-2xl text-2xl font-semibold">
          Not a traditional theater — a members&apos; club for people who love film.
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
          Because we don&apos;t publicly advertise every screening, we can show a wider range of films at a lower cost. If there&apos;s
          a movie you want to see on the big screen, just let us know — odds are, we can get it for you.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="card">
            <h3 className="font-medium text-[var(--accent)]">Private access</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">Screenings and events exclusive to members — a close-knit community of film fans.</p>
          </div>
          <div className="card">
            <h3 className="font-medium text-[var(--accent)]">Curated programming</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">Timeless classics, groundbreaking independent films, and hidden gems.</p>
          </div>
          <div className="card">
            <h3 className="font-medium text-[var(--accent)]">Comfort &amp; community</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">An intimate setting built for conversation — more living room than megaplex.</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card flex flex-col">
          <div className="eyebrow mb-2">Become a member</div>
          <h2 className="font-display text-xl font-semibold">Free to join, unlimited with Insiders+</h2>
          <p className="mt-2 flex-1 text-sm text-[var(--muted)]">
            Royale Insiders is free — a mailing list, a $5 day pass, and points on every purchase. Upgrade to Insiders+ for unlimited
            free entry to every screening, concession discounts, and priority access, from $10/mo.
          </p>
          <Link href="/membership" className="btn-secondary mt-4 self-start">
            Explore membership options
          </Link>
        </div>
        <div className="card flex flex-col">
          <div className="eyebrow mb-2">Food &amp; drink</div>
          <h2 className="font-display text-xl font-semibold">A full menu, made for movie night</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Snacks, soft drinks, draft beer, wine from Eagles Landing, and specialty cocktails — plus vegan, dairy-free, and
            gluten-free options. Try one of our movie-themed coffee bar drinks: City of Stars, Oppenheimer, Titanic.
          </p>
          <Link href="/menu" className="btn-secondary mt-4 self-start">
            View our menu
          </Link>
        </div>
      </section>

      <section className="card">
        <div className="eyebrow mb-2">Video lounge</div>
        <h2 className="font-display text-xl font-semibold">Revisit classics on our VHS archive</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          A haven for film lovers who want to experience the magic of &quot;dead formats.&quot; Members have exclusive access to our
          treasure trove of VHS tapes — curl up in a comfy seat, pop in a cassette, and travel back in time.
        </p>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold">Frequently asked questions</h2>
          <Link href="/about#faq" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
            View all FAQs →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card-flat">
            <div className="font-medium">What films will you be screening?</div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              Everything from modern indie hits to classics spanning the last 60 years, plus new independent features every week.
            </div>
          </div>
          <div className="card-flat">
            <div className="font-medium">How can I purchase tickets?</div>
            <div className="mt-1 text-sm text-[var(--muted)]">Online through our showtimes page, or at the door, subject to availability.</div>
          </div>
        </div>
      </section>

      <section className="card flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <div className="eyebrow mb-2">Visit us</div>
          <h2 className="font-display text-xl font-semibold">715 E Broadway, Joplin, MO 64801</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">One of the oldest buildings in the city, on Historic Route 66 since 1920.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Get directions
          </a>
          <a href="tel:+14172814172" className="btn-secondary">
            Call 417-281-4172
          </a>
        </div>
      </section>
    </div>
  );
}
