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

export default async function HomePage() {
  const screenings = (await getUpcomingScreenings()).slice(0, 6);

  return (
    <div className="space-y-14">
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
    </div>
  );
}
