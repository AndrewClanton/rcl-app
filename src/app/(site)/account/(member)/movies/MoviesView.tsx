import Link from "next/link";
import { yearOf, type MemberScreening } from "@/lib/data/member-account";
import TicketCard from "@/components/TicketCard";
import { Empty, SectionHead, STACK, TicketStub } from "../ui";

export default function MoviesView({ upcoming, past, tonight = [] }: { upcoming: MemberScreening[]; past: MemberScreening[]; tonight?: MemberScreening[] }) {
  // Tonight's first (including a show that started a few minutes ago, for
  // anyone running late), then the rest still to come. Each is a full
  // ticket with its code for the door.
  const isTonight = (s: MemberScreening) => tonight.some((t) => t.bookingId === s.bookingId);
  const current = [...tonight, ...upcoming.filter((s) => !isTonight(s))];
  const watched = past.filter((s) => !isTonight(s));
  const byYear = new Map<number, MemberScreening[]>();
  for (const s of watched) {
    const y = yearOf(s.startsAt);
    byYear.set(y, [...(byYear.get(y) ?? []), s]);
  }
  const distinctTitles = new Set(watched.map((s) => s.title)).size;

  return (
    <div className={STACK}>
      {watched.length > 0 && (
        <p className="font-display max-w-[30ch] text-2xl leading-tight text-balance sm:text-3xl">
          You&apos;ve been to <span className="bg-[var(--gold)] px-1.5">{watched.length}</span> screening{watched.length === 1 ? "" : "s"} at the Royale
          {distinctTitles !== watched.length ? ` (${distinctTitles} different films)` : ""}.
        </p>
      )}

      <section>
        <SectionHead title="Upcoming" />
        {current.length === 0 ? (
          <Empty>
            No tickets for upcoming screenings.{" "}
            <Link href="/showtimes" className="font-bold text-[var(--accent)] hover:underline">
              See showtimes
            </Link>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 sm:gap-7">
            {current.map((s) => (
              <TicketCard key={s.bookingId} t={s} />
            ))}
          </div>
        )}
      </section>

      {[...byYear.entries()].map(([year, list]) => (
        <section key={year}>
          <h2 className="font-display mb-4 flex flex-wrap items-baseline gap-x-3 text-xl leading-tight sm:text-2xl">
            {year} <span className="spec-code">{list.length} screening{list.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            {list.map((s) => (
              <TicketStub key={s.bookingId} s={s} past />
            ))}
          </div>
        </section>
      ))}

      {watched.length === 0 && current.length === 0 && <p className="text-[15px] text-[var(--muted)]">Screenings you buy tickets for while signed in to this account show up here.</p>}
    </div>
  );
}
