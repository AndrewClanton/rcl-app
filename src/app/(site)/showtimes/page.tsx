import { Fragment } from "react";
import Link from "next/link";
import { getPubliclyVisibleScreenings, PUBLIC_SCHEDULE_WINDOW_DAYS } from "@/lib/data/screenings";
import MoviePoster from "@/components/MoviePoster";
import { jsonLdScript, screeningEventJsonLd } from "@/lib/seo/screening-events";
import { pageMeta } from "@/lib/seo/page-meta";
import type { Screening } from "@/lib/types";
import { PageMasthead, ProofStamp, SpecFoot } from "@/components/print";
import PlusLink from "@/components/PlusLink";
import { ANNUAL_PRICE, RATE_PRICE, dollars } from "@/lib/membership-rates";

// The same listing for everyone, rebuilt at most once a minute (and at once
// when the schedule changes: admin/screenings/actions.ts revalidates it).
// The Insiders+ wording is switched in the member's browser (plus-show /
// plus-hide, see components/site/plus-hint.ts).
export const revalidate = 60;

// "Movie showtimes in Joplin" is what people actually search for, so the
// title and description say it plainly.
export const metadata = pageMeta({
  title: "Movie Showtimes in Joplin, MO",
  description: "Today's movie showtimes at Royale Cinema Lounge, a dine-in cinema and bar at 715 E Broadway in Joplin, MO. See what's playing and reserve your seat.",
  path: "/showtimes",
});

const TZ = "America/Chicago";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

type Film = { key: string; movie: Screening["movie"]; room: string; price: number; showings: Screening[] };
type Day = { key: string; label: string; short: string; films: Film[]; count: number };

// A day at a time, then one row per film (and room) with its times as
// chips -- how a cinema listing reads, instead of one row per showing.
function groupByDay(screenings: Screening[]): Day[] {
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const days = new Map<string, Day>();
  for (const s of screenings) {
    const when = new Date(s.starts_at);
    const key = dayKey(when);
    let day = days.get(key);
    if (!day) {
      const long = when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
      const short = key === today ? "Today" : key === tomorrow ? "Tomorrow" : when.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: TZ });
      day = { key, label: key === today ? `Today · ${long}` : key === tomorrow ? `Tomorrow · ${long}` : long, short, films: [], count: 0 };
      days.set(key, day);
    }
    const filmKey = `${s.movie.id ?? s.movie.title}|${s.room.name}`;
    let film = day.films.find((f) => f.key === filmKey);
    if (!film) {
      film = { key: filmKey, movie: s.movie, room: s.room.name, price: s.ticket_price, showings: [] };
      day.films.push(film);
    }
    film.showings.push(s);
    day.count++;
  }
  return [...days.values()];
}

// The Insiders+ offer, set right among the listings: every showing on the
// page is free with it.
function PlusBand({ count }: { count: number }) {
  return (
    <aside className="plus-hide sheet halftone halftone-hero relative flex flex-wrap items-center justify-between gap-6 bg-[var(--gold)] p-6 !border-4 !shadow-[7px_7px_0_var(--foreground)] sm:p-7">
      <div className="relative z-[1] max-w-xl">
        <span className="ctag ctag-red">Insiders+</span>
        <p className="font-display mt-4 text-3xl leading-tight text-balance">
          {count > 1 ? `All ${count} showtimes on this page, free.` : "Every showtime, free."}
        </p>
        <p className="mt-2 text-[15px] font-bold">
          ${RATE_PRICE.adult} a month covers every screening, or {dollars(ANNUAL_PRICE.adult)} a year. No tickets, no per-show price.
        </p>
      </div>
      <div className="relative z-[1] flex flex-col items-stretch gap-3 sm:items-center">
        <PlusLink next="/showtimes" className="btn-primary -rotate-[1.5deg] px-6 py-3 text-center text-base">
          Get Insiders+ · ${RATE_PRICE.adult}/mo
        </PlusLink>
        <Link href="/membership" className="text-center text-sm font-bold underline decoration-2 underline-offset-2">
          What&apos;s included
        </Link>
      </div>
    </aside>
  );
}

export default async function ShowtimesPage() {
  const screenings = await getPubliclyVisibleScreenings();
  const days = groupByDay(screenings);
  const events = screenings.map((s) => screeningEventJsonLd(s)).filter(Boolean);
  const todayKey = dayKey(new Date());

  return (
    <div>
      {events.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(events) }} />}
      <PageMasthead
        eyebrow="Joplin · Route 66"
        title="Showtimes"
        className="!mb-6"
        intro={
          <>
            Showtimes post {PUBLIC_SCHEDULE_WINDOW_DAYS} days out. Tap a time to get tickets, or{" "}
            <a href="mailto:info@royalecinemajoplin.com?subject=Screening%20request" className="font-bold text-[var(--accent)] hover:underline">
              ask us
            </a>{" "}
            what&apos;s coming up.
          </>
        }
      />

      {screenings.length === 0 ? (
        <div className="sheet mt-8 p-5 text-[15px]">No screenings scheduled yet. Check back soon.</div>
      ) : (
        <>
          <nav aria-label="Jump to a day" className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2">
            {days.map((d) => (
              <a key={d.key} href={`#d-${d.key}`} className={`day-chip ${d.key === todayKey ? "day-chip-today" : ""}`}>
                {d.short}
              </a>
            ))}
          </nav>

          <div className="mt-6 space-y-10">
            {days.map((day, i) => (
              <Fragment key={day.key}>
              <section id={`d-${day.key}`} className="site-anchor sheet crop">
                <h2 className="spec-head rounded-t-[4px]">
                  <span>{day.label}</span>
                  <span className="flex items-center gap-4">
                    <span className="hidden sm:inline">
                      {day.films.length} film{day.films.length === 1 ? "" : "s"} · {day.count} show{day.count === 1 ? "" : "s"}
                    </span>
                    {day.key === todayKey && <ProofStamp>Tonight</ProofStamp>}
                  </span>
                </h2>
                <ul>
                  {day.films.map((film) => (
                    <li key={film.key} className="grid grid-cols-[56px_1fr] gap-4 border-b border-[var(--border)] p-4 last:border-b-0 sm:grid-cols-[72px_1fr] sm:p-5">
                      <Link href={`/showtimes/${film.showings[0].id}`} className="block overflow-hidden rounded-[3px] border-2 border-[var(--foreground)]">
                        <MoviePoster posterUrl={film.movie.poster_url} title={film.movie.title} sizes="72px" />
                      </Link>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-lg leading-tight sm:text-xl">{film.movie.title}</h3>
                          {film.room.toLowerCase().includes("outdoor") && <span className="ctag ctag-yellow">Outdoor</span>}
                        </div>
                        <div className="spec-k mt-1 !mb-0">
                          {[film.room, film.movie.runtime_minutes ? `${film.movie.runtime_minutes} min` : null, film.movie.rating, film.price === 0 ? "Free" : `$${film.price.toFixed(2)} + tax`]
                            .filter(Boolean)
                            .join(" · ")}
                          {film.price > 0 && (
                            <span className="text-[var(--accent)]">
                              {" · "}
                              <span className="plus-show">Free with your Insiders+</span>
                              <span className="plus-hide">Free with Insiders+</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {film.showings.map((s) => (
                            <Link key={s.id} href={`/showtimes/${s.id}`} className="time-chip" aria-label={`${film.movie.title} at ${timeLabel(s.starts_at)}`}>
                              {timeLabel(s.starts_at).replace(/ (AM|PM)$/, "")}
                              <small>{timeLabel(s.starts_at).slice(-2)}</small>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <SpecFoot />
              </section>
              {/* After the first day: the offer, while the times are in view. */}
              {i === 0 && <PlusBand count={screenings.length} />}
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
