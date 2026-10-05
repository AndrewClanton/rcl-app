import { Fragment, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getMembersOnlyScreenings, getMembersOnlySlots, getPubliclyVisibleScreenings, PUBLIC_SCHEDULE_WINDOW_DAYS } from "@/lib/data/screenings";
import InsiderTeaser from "@/components/site/InsiderTeaser";
import { getSignedInMember } from "@/lib/member-auth";
import MoviePoster from "@/components/MoviePoster";
import ScreenTag from "@/components/site/ScreenTag";
import { jsonLdScript, screeningEventJsonLd } from "@/lib/seo/screening-events";
import { pageMeta } from "@/lib/seo/page-meta";
import { isOutdoorRoom, OUTDOOR_SCREEN_LABEL } from "@/lib/showing-visibility";
import type { Screening } from "@/lib/types";
import { PageMasthead, ProofStamp, SpecFoot } from "@/components/print";
import PlusLink from "@/components/PlusLink";
import { ANNUAL_PRICE, RATE_PRICE, dollars } from "@/lib/membership-rates";

// The same listing for everyone, drawn per request: the day labels and which
// showings are listed (started? this year's release?) depend on the clock,
// and a cached copy of the page could be hours old on a quiet night. The
// database rows behind it are cached instead (getPubliclyVisibleScreenings
// in lib/data/screenings.ts). The Insiders+ wording is switched in the
// member's browser (plus-show / plus-hide, see components/site/plus-hint.ts).
//
// The one per-visitor part is MembersOnlyShowings: a signed-in member also
// sees the members-only showings. A guest gets only their days and times
// (InsiderTeaser), never a title: not in the HTML, the JSON-LD or the sitemap.
//
// ?screen=outdoor (and /outdoor, which redirects here) lists the outdoor
// screen's showings only: the link to share when people ask what's on
// outside.

type SearchParams = Promise<{ screen?: string | string[] }>;
const isOutdoorView = (screen: string | string[] | undefined) => screen === "outdoor";

// "Movie showtimes in Joplin" is what people actually search for, so the
// title and description say it plainly.
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  if (isOutdoorView((await searchParams).screen)) {
    return pageMeta({
      title: "Outdoor Movies in Joplin, MO",
      description: "What's on the outdoor screen at Royale Cinema Lounge, on the patio at 715 E Broadway in Joplin, MO. Weather permitting.",
      path: "/showtimes?screen=outdoor",
    });
  }
  return pageMeta({
    title: "Movie Showtimes in Joplin, MO",
    description: "Today's movie showtimes at Royale Cinema Lounge, a cinema, bar and members' lounge at 715 E Broadway in Joplin, MO. See what's playing and reserve your seat.",
    path: "/showtimes",
  });
}

const TZ = "America/Chicago";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: TZ });

type Film = { key: string; movie: Screening["movie"]; room: Screening["room"]; price: number; showings: Screening[] };
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
    const filmKey = `${s.movie.id ?? s.movie.title}|${s.room.id ?? s.room.name}`;
    let film = day.films.find((f) => f.key === filmKey);
    if (!film) {
      film = { key: filmKey, movie: s.movie, room: s.room, price: s.ticket_price, showings: [] };
      day.films.push(film);
    }
    film.showings.push(s);
    day.count++;
  }
  return [...days.values()];
}

// The days of "this weekend" in Joplin: Friday to Sunday, from today on if
// it's already the weekend, else the coming one.
function weekendKeys(now = Date.now()): Set<string> {
  const keys = new Set<string>();
  for (let d = 0; d < 7; d++) {
    const at = new Date(now + d * 86_400_000);
    const wd = at.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
    if (wd === "Fri" || wd === "Sat" || wd === "Sun") keys.add(dayKey(at));
    else if (keys.size > 0) break;
  }
  return keys;
}

function FilmRow({ film, membersOnly = false }: { film: Film; membersOnly?: boolean }) {
  return (
    <li className="grid grid-cols-[56px_1fr] gap-4 border-b border-[var(--border)] p-4 last:border-b-0 sm:grid-cols-[72px_1fr] sm:p-5">
      <Link href={`/showtimes/${film.showings[0].id}`} className="block overflow-hidden rounded-[3px] border-2 border-[var(--foreground)]">
        <MoviePoster posterUrl={film.movie.poster_url} title={film.movie.title} sizes="72px" />
      </Link>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg leading-tight sm:text-xl">{film.movie.title}</h3>
          {membersOnly && <span className="ctag ctag-red">Members only</span>}
          {isOutdoorRoom(film.room) && <span className="ctag ctag-yellow">Outdoor</span>}
        </div>
        <div className="spec-k mt-1 !mb-0">
          <ScreenTag room={film.room} className="align-middle" />
          {[film.movie.runtime_minutes ? `${film.movie.runtime_minutes} min` : null, film.movie.rating, film.price === 0 ? "Free" : `$${film.price.toFixed(2)} + tax`]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
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
  );
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

// "On the outdoor screen this weekend": the patio's showings Friday to
// Sunday, or the next ones coming if there are none this weekend.
function OutdoorWeekend({ screenings }: { screenings: Screening[] }) {
  const outdoor = screenings.filter((s) => isOutdoorRoom(s.room));
  if (outdoor.length === 0) return null;
  const weekend = weekendKeys();
  const thisWeekend = outdoor.filter((s) => weekend.has(dayKey(new Date(s.starts_at))));
  const shows = thisWeekend.length > 0 ? thisWeekend : outdoor.slice(0, 3);
  return (
    <section aria-labelledby="outdoor-weekend" className="sheet mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="outdoor-weekend" className="font-display text-2xl leading-tight">
          {thisWeekend.length > 0 ? "On the outdoor screen this weekend" : "Next on the outdoor screen"}
        </h2>
        <Link href="/showtimes?screen=outdoor" className="text-sm font-bold underline decoration-2 underline-offset-2">
          All outdoor showings
        </Link>
      </div>
      <p className="spec-k mt-1 !mb-0">
        <ScreenTag room={outdoor[0].room} /> · On the patio
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {shows.map((s) => (
          <li key={s.id}>
            <Link href={`/showtimes/${s.id}`} className="day-chip inline-block">
              {shortDay(s.starts_at)} · {timeLabel(s.starts_at)} · {s.movie.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A signed-in member's members-only showings. A guest gets the teaser: the
// days and times, never a title (the outdoor screen and Midweek Movies
// aren't licensed for public advertising).
async function MembersOnlyShowings({ outdoorOnly }: { outdoorOnly: boolean }) {
  const member = await getSignedInMember();
  if (!member) {
    const slots = await getMembersOnlySlots();
    return <InsiderTeaser slots={outdoorOnly ? slots.filter((s) => s.outdoor) : slots} next={outdoorOnly ? "/showtimes?screen=outdoor" : "/showtimes"} />;
  }
  const all = await getMembersOnlyScreenings(member);
  const shows = outdoorOnly ? all.filter((s) => isOutdoorRoom(s.room)) : all;
  if (shows.length === 0) return null;
  return (
    <section id="members-only" className="site-anchor sheet crop mt-6">
      <h2 className="spec-head rounded-t-[4px]">
        <span>Members only</span>
        <span className="hidden sm:inline">For you, since you&apos;re signed in. Please don&apos;t post these.</span>
      </h2>
      {groupByDay(shows).map((day) => (
        <Fragment key={day.key}>
          <div className="border-b border-[var(--border)] px-4 pt-4 pb-2 text-sm font-bold sm:px-5">{day.label}</div>
          <ul>
            {day.films.map((film) => (
              <FilmRow key={film.key} film={film} membersOnly />
            ))}
          </ul>
        </Fragment>
      ))}
      <SpecFoot />
    </section>
  );
}

export default async function ShowtimesPage({ searchParams }: { searchParams: SearchParams }) {
  const outdoorOnly = isOutdoorView((await searchParams).screen);
  const everything = await getPubliclyVisibleScreenings();
  const screenings = outdoorOnly ? everything.filter((s) => isOutdoorRoom(s.room)) : everything;
  const days = groupByDay(screenings);
  // Members-only showings fill the gap (the teaser or the member's list), so
  // "nothing on" is only said when there's truly nothing.
  const insiderSlots = (await getMembersOnlySlots()).filter((s) => !outdoorOnly || s.outdoor);
  const events = screenings.map((s) => screeningEventJsonLd(s)).filter(Boolean);
  const todayKey = dayKey(new Date());

  return (
    <div>
      {events.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(events) }} />}
      <PageMasthead
        eyebrow="Joplin · Route 66"
        title={outdoorOnly ? "The outdoor screen" : "Showtimes"}
        className="!mb-6"
        intro={
          outdoorOnly ? (
            <>
              Movies on the patio, {OUTDOOR_SCREEN_LABEL.split(" · ")[1]}. Showtimes post {PUBLIC_SCHEDULE_WINDOW_DAYS} days out. Tap a time to get tickets.
            </>
          ) : (
            <>
              Showtimes post {PUBLIC_SCHEDULE_WINDOW_DAYS} days out. Tap a time to get tickets, or{" "}
              <a href="mailto:info@royalecinemajoplin.com?subject=Screening%20request" className="font-bold text-[var(--accent)] hover:underline">
                ask us
              </a>{" "}
              what&apos;s coming up.
            </>
          )
        }
      />

      {/* Which screen: everything, or just the outdoor one. */}
      <nav aria-label="Which screen" className="mt-4 flex flex-wrap gap-2">
        <Link href="/showtimes" className={`day-chip ${outdoorOnly ? "" : "day-chip-today"}`} aria-current={outdoorOnly ? undefined : "page"}>
          All showtimes
        </Link>
        <Link href="/showtimes?screen=outdoor" className={`day-chip ${outdoorOnly ? "day-chip-today" : ""}`} aria-current={outdoorOnly ? "page" : undefined}>
          Outdoor screen
        </Link>
      </nav>

      {!outdoorOnly && <OutdoorWeekend screenings={everything} />}

      <Suspense fallback={null}>
        <MembersOnlyShowings outdoorOnly={outdoorOnly} />
      </Suspense>

      {screenings.length === 0 && insiderSlots.length > 0 ? null : screenings.length === 0 ? (
        <div className="sheet mt-8 p-5 text-[15px]">
          {outdoorOnly ? (
            <>
              Nothing on the outdoor screen in the next {PUBLIC_SCHEDULE_WINDOW_DAYS} days. <Link href="/showtimes" className="font-bold text-[var(--accent)] hover:underline">See everything that&apos;s playing</Link>.
            </>
          ) : (
            "No screenings scheduled yet. Check back soon."
          )}
        </div>
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
                      <FilmRow key={film.key} film={film} />
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
