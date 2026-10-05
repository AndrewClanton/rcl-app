import { ANNUAL_PRICE, RATE_PRICE, dollars } from "@/lib/membership-rates";
import { LOYALTY_SUMMARY } from "@/lib/loyalty";
import { DAILY_COFFEE_PERK } from "@/lib/daily-perk";
import Image from "next/image";
import Link from "next/link";
import { getPubliclyVisibleScreenings } from "@/lib/data/screenings";
import MoviePoster from "@/components/MoviePoster";
import ScreenTag from "@/components/site/ScreenTag";
import { isOutdoorRoom } from "@/lib/showing-visibility";
import PlusLink from "@/components/PlusLink";
import { Seal, SpecFoot, Sprockets, Starburst } from "@/components/print";
import type { Screening } from "@/lib/types";
import { businessDay, businessDayWindow } from "@/lib/ops/time";
import { DIRECTIONS_URL, SITE_DESCRIPTION } from "@/lib/site";
import { pageMeta } from "@/lib/seo/page-meta";

// The same page for everyone, drawn per request: "Tonight", "Today" and
// "Tomorrow" and which showings are listed (started? this year's release?)
// depend on the clock, and a cached copy of the page could be hours old on a
// quiet night (Next serves the old copy first and rebuilds it afterwards).
// The database rows behind it are cached instead (getPubliclyVisibleScreenings
// in lib/data/screenings.ts), and it reads no cookies. What differs for
// Insiders+ members is switched in their browser (the plus-show / plus-hide
// classes, see components/site/plus-hint.ts).

export const metadata = pageMeta({
  title: { absolute: "Royale Cinema Lounge · Cinema, bar & lounge in Joplin, MO" },
  description: SITE_DESCRIPTION,
  path: "/",
});

const TZ = "America/Chicago";

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
function whenLabel(iso: string) {
  const d = new Date(iso);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const day = dayKey(d) === today ? "Today" : dayKey(d) === tomorrow ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: TZ });
  return { day, time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }) };
}

// One card per film (its next few showings as chips), not one per showing --
// otherwise the same poster fills half the row.
function nextFilms(screenings: Screening[], limit: number) {
  const films: { key: string; first: Screening; showings: Screening[] }[] = [];
  for (const s of screenings) {
    const key = s.movie.id ?? s.movie.title;
    const film = films.find((f) => f.key === key);
    if (film) {
      if (film.showings.length < 3) film.showings.push(s);
    } else if (films.length < limit) {
      films.push({ key, first: s, showings: [s] });
    }
  }
  return films;
}

// What's still to come today, by the business day (4 AM to 4 AM Central),
// so a late show after midnight still counts as tonight's. The screenings
// are already upcoming-only and MPLC-filtered.
function laterToday(screenings: Screening[]) {
  const { date } = businessDay();
  const end = new Date(businessDayWindow(date).end).getTime();
  const showings = screenings.filter((s) => new Date(s.starts_at).getTime() < end);
  const hour = (iso: string) => Number(new Date(iso).toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }));
  // "Tonight" only when every remaining show is an evening (or after-midnight) one.
  const evening = showings.every((s) => hour(s.starts_at) >= 17 || hour(s.starts_at) < 4);
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return { showings, label: evening ? "Tonight" : "Today", dateLabel };
}

// A compact strip right under the hero: today's remaining showtimes, each a
// ticket-stub chip with its film. Hidden when nothing's left today.
function TonightStrip({ showings, label, dateLabel }: ReturnType<typeof laterToday>) {
  if (showings.length === 0) return null;
  return (
    // Pulled up under the hero: the page's 80px section gap is too loose for
    // something that belongs to it.
    <section aria-labelledby="tonight-strip" className="sheet -mt-15 flex flex-col sm:flex-row">
      <h2
        id="tonight-strip"
        className="spec-head flex-none rounded-t-[4px] sm:flex-col sm:items-start sm:justify-center sm:gap-1 sm:rounded-tr-none sm:rounded-bl-[4px] sm:px-5"
      >
        <span className="text-base leading-none">{label}</span>
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-[rgba(248,245,236,0.72)]">{dateLabel}</span>
      </h2>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 p-3 sm:p-4">
        {showings.map((s) => {
          const time = new Date(s.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
          return (
            <li key={s.id} className="max-w-full min-w-0">
              <Link href={`/showtimes/${s.id}`} className="time-chip max-w-full !gap-2" aria-label={`${s.movie.title} at ${time}`}>
                <span className="flex-none">
                  {time.replace(/ (AM|PM)$/, "")}
                  <small> {time.slice(-2)}</small>
                </span>
                <span aria-hidden="true" className="w-0.5 flex-none self-stretch bg-[var(--foreground)] opacity-25" />
                <span className="min-w-0 truncate">{s.movie.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Perk({ children, off = false }: { children: React.ReactNode; off?: boolean }) {
  return (
    <li className={`flex gap-2.5 ${off ? "text-[var(--muted)]" : ""}`}>
      <span aria-hidden="true" className={`font-display mt-px w-4 flex-none text-center ${off ? "" : "text-[var(--accent)]"}`}>
        {off ? "–" : "✓"}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default async function HomePage() {
  const allScreenings = await getPubliclyVisibleScreenings();
  // Visitors get the Insiders+ tile as the last spot in the grid, so the
  // offer sits right among the showings it pays for; Insiders+ members get
  // a sixth film there instead.
  const films = nextFilms(allScreenings, 6);
  const today = laterToday(allScreenings);

  return (
    <div className="space-y-20">
      {/* Panel Pop: the loud one, with its registration mark at the corner. */}
      <section className="sheet overflow-hidden !border-[3px] !shadow-[7px_7px_0_var(--foreground)]">
        <div className="halftone halftone-hero relative bg-[var(--gold)] px-6 pt-16 pb-14 text-center sm:px-12 sm:pt-20 sm:pb-16">
          <Starburst className="starburst-red absolute top-5 right-6 z-[2] hidden sm:block">
            Route
            <br />
            66
          </Starburst>
          <div className="relative z-[1]">
            <Image src="/photos/logo.png" alt="Royale Cinema Lounge" width={1434} height={505} priority className="mx-auto mb-6 h-auto w-52 sm:w-64" style={{ filter: "invert(1) brightness(0.08)" }} />
            <span className="ctag ctag-red">Joplin, MO</span>
            <h1 className="font-display mx-auto mt-5 max-w-3xl text-4xl leading-[0.98] text-balance sm:text-6xl">micro cinema, third space, film archive</h1>
            <p className="mx-auto mt-5 max-w-xl text-[15px] font-medium sm:text-base">
              Royale Cinema Lounge is a cinema, bar and members&apos; lounge. Grab a drink and a bite at the bar, find your seat, and catch a show.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/showtimes" className="btn-primary -rotate-[1.5deg] px-6 py-3">
                See showtimes
              </Link>
              <Link href="/menu" className="btn-secondary px-6 py-3">
                View menu
              </Link>
            </div>
          </div>
        </div>
        <div className="ht-ink-red border-t-[3px] border-[var(--foreground)] bg-[var(--foreground)] px-6 py-3 text-center font-mono text-xs tracking-[0.12em] text-[var(--background)]">
          <span className="relative z-[1]">715 E BROADWAY · JOPLIN, MO · ON ROUTE 66</span>
        </div>
      </section>

      <TonightStrip {...today} />

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="ctag ctag-yellow">Now showing</span>
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <h2 className="font-display text-3xl">Coming up</h2>
            </div>
          </div>
          <Link href="/showtimes" className="text-sm font-bold text-[var(--accent)] hover:underline">
            All showtimes →
          </Link>
        </div>
        {films.length === 0 ? (
          <div className="sheet p-5 text-[15px]">No screenings scheduled yet. Check back soon.</div>
        ) : (
          <div className="grid gap-7 pt-2 sm:grid-cols-2 lg:grid-cols-3">
            {films.map(({ key, first, showings }, i) => (
              <article key={key} className={`sheet crop relative flex flex-col ${i === 5 ? "plus-show" : ""}`}>
                <Link href={`/showtimes/${first.id}`} className="block overflow-hidden rounded-t-[4px] border-b-2 border-[var(--foreground)]">
                  <MoviePoster posterUrl={first.movie.poster_url} title={first.movie.title} sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 90vw" />
                </Link>
                <span className="ctag ctag-yellow absolute -top-3 right-3 z-[1]">{first.ticket_price === 0 ? "Free" : `$${first.ticket_price.toFixed(2)}`}</span>
                {isOutdoorRoom(first.room) && <span className="ctag ctag-ink absolute top-3 left-3 z-[1]">Outdoor</span>}
                <div className="flex flex-1 flex-col px-4 py-4">
                  <h3 className="font-display text-xl leading-tight">
                    <Link href={`/showtimes/${first.id}`} className="hover:underline">
                      {first.movie.title}
                    </Link>
                  </h3>
                  <div className="spec-k mt-1 !mb-0">
                    <ScreenTag room={first.room} className="align-middle" />
                    {[first.movie.runtime_minutes ? `${first.movie.runtime_minutes} min` : null, first.movie.rating].filter(Boolean).map((p) => ` · ${p}`).join("")}
                  </div>
                  <div className="mt-3 flex flex-1 flex-wrap content-start gap-2">
                    {showings.map((s) => {
                      const w = whenLabel(s.starts_at);
                      return (
                        <Link key={s.id} href={`/showtimes/${s.id}`} className="time-chip !text-sm">
                          {w.day} <small>{w.time}</small>
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <SpecFoot />
              </article>
            ))}
            <article className="plus-hide sheet halftone halftone-hero relative flex flex-col justify-between bg-[var(--gold)] !border-4 !shadow-[7px_7px_0_var(--foreground)]">
              <div className="relative z-[1] p-6">
                <span className="ctag ctag-red">Insiders+</span>
                <p className="font-display mt-5 text-3xl leading-tight text-balance">Every film here, free.</p>
                <div className="font-display mt-4 text-6xl leading-none tabular-nums">${RATE_PRICE.adult}</div>
                <div className="mt-1 text-[15px] font-bold">a month, for every screening. Or {dollars(ANNUAL_PRICE.adult)} a year.</div>
              </div>
              <div className="relative z-[1] px-6 pb-6">
                <PlusLink className="btn-primary block -rotate-[1.5deg] px-5 py-3 text-center">Get Insiders+</PlusLink>
                <a href="#insiders" className="mt-3 block text-center text-sm font-bold underline decoration-2 underline-offset-2">
                  What&apos;s included
                </a>
              </div>
            </article>
          </div>
        )}
      </section>

      {/* Right under the showings: every one of them is free with Insiders+.
          Insiders+ members don't need the pitch. Same cards as /membership. */}
      <section id="insiders" className="plus-hide site-anchor">
        <div className="eyebrow mb-2">Insiders+</div>
        <h2 className="font-display max-w-2xl text-3xl leading-tight text-balance">See every one of these for ${RATE_PRICE.adult} a month.</h2>
        <p className="mt-3 max-w-xl text-[15px] text-[var(--muted)]">
          Insiders+ gets you into every screening free: all the showings above, and every one after them. No tickets, no per-show price.
        </p>
        <div className="mt-8 grid gap-7 md:grid-cols-[1.15fr_1fr]">
          <div className="sheet relative flex flex-col !border-4 !shadow-[7px_7px_0_var(--foreground)]">
            <div className="halftone halftone-hero relative rounded-t-[2px] border-b-[3px] border-[var(--foreground)] bg-[var(--gold)] px-5 py-5">
              <div className="relative z-[1]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="spec-k !text-[var(--foreground)]">Unlimited screenings</div>
                    <div className="font-display text-3xl">Insiders+</div>
                  </div>
                  <span className="ctag ctag-red">Free entry</span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-4xl leading-none">${RATE_PRICE.adult}/mo</span>
                  <span className="text-[15px] font-bold">or {dollars(ANNUAL_PRICE.adult)}/yr, save 15%</span>
                </div>
              </div>
            </div>
            <ul className="flex-1 space-y-2.5 px-5 py-5 text-[15px]">
              <Perk>
                <strong>Free entry to every screening</strong>, unlimited
              </Perk>
              <Perk>{DAILY_COFFEE_PERK}</Perk>
              <Perk>2 free booth reservations every month</Perk>
              <Perk>Concession and merch discounts</Perk>
              <Perk>First access to weekly titles and member events</Perk>
            </ul>
            <div className="px-5 pb-5">
              <PlusLink className="btn-primary block px-5 py-3 text-center">Get Insiders+ · ${RATE_PRICE.adult}/mo</PlusLink>
              <div className="spec-code mt-3">
                Seniors ${RATE_PRICE.senior}/mo · Students ${RATE_PRICE.student}/mo · with ID at the box office
              </div>
            </div>
          </div>
          <div className="sheet crop flex flex-col">
            <div className="border-b-2 border-[var(--foreground)] px-5 py-5">
              <div className="spec-k">Free forever</div>
              <div className="font-display text-3xl">Insiders</div>
              <div className="font-display mt-2 text-4xl leading-none">$0</div>
            </div>
            <ul className="flex-1 space-y-2.5 px-5 py-5 text-[15px]">
              <Perk>{LOYALTY_SUMMARY}</Perk>
              <Perk>Mailing list and the weekly lineup</Perk>
              <Perk off>Buy a ticket for each screening</Perk>
            </ul>
            <div className="px-5 pb-5">
              <Link href="/membership" className="btn-secondary block px-5 py-3 text-center">
                Join free
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Sprockets />

      <section>
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <div className="eyebrow mb-2">Why a member lounge?</div>
            <h2 className="font-display max-w-2xl text-3xl leading-tight text-balance">Not a traditional theater. A members&apos; club for people who love film.</h2>
            <p className="mt-3 max-w-2xl text-[15px] text-[var(--muted)]">
              We don&apos;t publish a full public schedule. That&apos;s what lets us bring in a much wider range of films, at a lower cost, than a typical theater could justify. Members
              always know what&apos;s playing.
            </p>
            <a href="mailto:info@royalecinemajoplin.com?subject=Screening%20request" className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--accent)] hover:underline">
              Request a screening →
            </a>
          </div>
          <div className="sheet crop relative aspect-[3/2]">
            <div className="print-photo absolute inset-0 overflow-hidden rounded-[4px]">
              <Image src="/photos/vhs-shelf-couple.jpg" alt="Guests browsing the VHS shelf at Royale Cinema Lounge" fill sizes="(min-width: 1024px) 480px, 100vw" className="object-cover" />
            </div>
          </div>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            ["01", "Private access", "Screenings and events for members: a close-knit community of film fans."],
            ["02", "Curated programming", "Timeless classics, groundbreaking independent films, and hidden gems."],
            ["03", "Comfort & community", "An intimate setting built for conversation. More living room than megaplex."],
          ].map(([n, title, body]) => (
            <div key={n} className="sheet crop p-5">
              <div className="spec-code">{n}</div>
              <h3 className="font-display mt-1 text-xl">{title}</h3>
              <p className="mt-2 text-[15px] text-[var(--muted)]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sheet overflow-hidden">
        <div className="grid sm:grid-cols-[1.2fr_1fr]">
          <div className="p-6">
            <div className="eyebrow mb-2">Food &amp; drink</div>
            <h2 className="font-display text-2xl">A menu made for movie night</h2>
            <p className="mt-2 text-[15px] text-[var(--muted)]">
              Snacks, soft drinks, draft beer, wine from Eagles Landing, and specialty cocktails. Try one of our movie-themed coffee bar drinks: City of Stars, Oppenheimer, Titanic.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <span className="ctag ctag-yellow">Now serving</span>
              <span className="ctag ctag-red">21+</span>
            </div>
            <Link href="/menu" className="btn-secondary mt-6 inline-block px-5 py-3">
              View our menu
            </Link>
          </div>
          <div className="relative aspect-[3/2] border-t-2 border-[var(--foreground)] sm:aspect-auto sm:border-t-0 sm:border-l-2">
            <Image src="/photos/popcorn-reeses.png" alt="" fill sizes="(min-width: 640px) 420px, 100vw" className="object-cover" />
          </div>
        </div>
      </section>

      <section className="sheet overflow-hidden">
        <div className="grid sm:grid-cols-[1fr_1.2fr]">
          <div className="print-photo relative aspect-[4/3] border-b-2 border-[var(--foreground)] sm:aspect-auto sm:border-r-2 sm:border-b-0">
            <Image src="/photos/video-lounge.png" alt="Royale Cinema Lounge's VHS video lounge, with tapes, posters, and a CRT television" fill sizes="(min-width: 640px) 380px, 100vw" className="object-cover" />
          </div>
          <div className="p-6">
            <div className="eyebrow mb-2">Video lounge</div>
            <h2 className="font-display text-2xl">Revisit the classics, anytime, in our VHS lounge</h2>
            <p className="mt-2 text-[15px] text-[var(--muted)]">Thousands of movies on hand to choose from. Pull a tape off the shelf, curl up in a comfy seat, pop it in, and travel back in time.</p>
          </div>
        </div>
      </section>

      <section className="sheet crop">
        <h2 className="spec-head rounded-t-[4px]">
          <span>Questions</span>
          <Link href="/about#faq" className="hover:underline">
            All FAQs →
          </Link>
        </h2>
        <dl className="grid sm:grid-cols-2">
          <div className="border-b border-[var(--border)] p-5 sm:border-r sm:border-b-0">
            <dt className="font-display text-lg leading-snug">Why don&apos;t you publish a full public schedule?</dt>
            <dd className="mt-2 text-[15px] text-[var(--muted)]">It&apos;s what lets us bring in a much wider range of films, at a lower cost, than a typical theater could justify. Members always know what&apos;s playing.</dd>
          </div>
          <div className="p-5">
            <dt className="font-display text-lg leading-snug">How can I get tickets?</dt>
            <dd className="mt-2 text-[15px] text-[var(--muted)]">Online through our showtimes page, or at the door, subject to availability.</dd>
          </div>
        </dl>
      </section>

      <Sprockets />

      <section className="sheet ht-ink-red relative flex flex-col justify-between gap-6 overflow-hidden !bg-[var(--foreground)] p-6 sm:flex-row sm:items-center">
        <div className="print-photo absolute inset-0 opacity-40">
          <Image src="/photos/lounge-neon.png" alt="" fill sizes="100vw" className="object-cover" />
        </div>
        <div className="relative z-[1] flex items-center gap-5">
          <Seal className="hidden sm:flex">
            Route
            <br />
            66
          </Seal>
          <div>
          <span className="ctag ctag-yellow">Visit us</span>
          <h2 className="font-display mt-3 text-2xl text-[var(--background)]">715 E Broadway, Joplin, MO 64801</h2>
          <p className="mt-1 text-[15px] text-[rgba(248,245,236,0.8)]">In one of the oldest buildings in the city, built in 1920 on what&apos;s now Historic Route 66.</p>
          </div>
        </div>
        <div className="relative z-[1] flex shrink-0 flex-wrap gap-3">
          <a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="btn-primary px-5 py-3">
            Get directions
          </a>
          <a href="tel:+14172814172" className="btn-secondary px-5 py-3">
            Call 417-281-4172
          </a>
        </div>
      </section>
    </div>
  );
}
