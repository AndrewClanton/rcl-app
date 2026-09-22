import type { Metadata } from "next";
import Link from "next/link";
import { getPubliclyVisibleScreenings, PUBLIC_SCHEDULE_WINDOW_DAYS } from "@/lib/data/screenings";
import MoviePoster from "@/components/MoviePoster";
import type { Screening } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Showtimes",
  description: "See what's playing at Royale Cinema Lounge in Joplin, MO, and reserve your seat.",
};

function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function groupByDate(screenings: Screening[]) {
  const groups = new Map<string, Screening[]>();
  for (const s of screenings) {
    const key = dateKey(s.starts_at);
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  return groups;
}

export default async function ShowtimesPage() {
  const screenings = await getPubliclyVisibleScreenings();
  const groups = groupByDate(screenings);

  return (
    <div>
      <h1 className="font-display mb-2 text-3xl font-semibold">Showtimes</h1>
      <p className="mb-8 max-w-2xl text-sm text-[var(--muted)]">
        Showtimes post {PUBLIC_SCHEDULE_WINDOW_DAYS} days out. Check back regularly, or{" "}
        <a href="mailto:info@royalecinemajoplin.com?subject=Screening%20request" className="font-bold text-[var(--accent)] hover:underline">
          ask us
        </a>{" "}
        what&apos;s coming up.
      </p>
      {screenings.length === 0 ? (
        <div className="card text-sm text-[var(--muted)]">No screenings scheduled yet — check back soon.</div>
      ) : (
        <div className="space-y-10">
          {[...groups.entries()].map(([date, list]) => (
            <div key={date}>
              <h2 className="eyebrow mb-3">{date}</h2>
              <div className="space-y-3">
                {list.map((s) => (
                  <Link key={s.id} href={`/showtimes/${s.id}`} className="card-flat flex items-center gap-4">
                    <div className="w-14 shrink-0 sm:w-16">
                      <MoviePoster posterUrl={s.movie.poster_url} title={s.movie.title} sizes="64px" />
                    </div>
                    <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.movie.title}</span>
                          {s.room.name.toLowerCase().includes("outdoor") && <span className="stamp-tag stamp-tag-gold">Outdoor</span>}
                        </div>
                        <div className="text-sm text-[var(--muted)]">
                          {timeLabel(s.starts_at)} · {s.room.name}
                          {s.movie.runtime_minutes ? ` · ${s.movie.runtime_minutes} min` : ""}
                          {s.movie.rating ? ` · ${s.movie.rating}` : ""}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-[var(--accent)]">{s.ticket_price === 0 ? "Free" : `$${s.ticket_price.toFixed(2)}`}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
