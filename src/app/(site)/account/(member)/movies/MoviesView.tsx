import Link from "next/link";
import { yearOf, type MemberScreening } from "@/lib/data/member-account";
import { Empty, TicketStub } from "../ui";

export default function MoviesView({ upcoming, past }: { upcoming: MemberScreening[]; past: MemberScreening[] }) {
  const byYear = new Map<number, MemberScreening[]>();
  for (const s of past) {
    const y = yearOf(s.startsAt);
    byYear.set(y, [...(byYear.get(y) ?? []), s]);
  }
  const distinctTitles = new Set(past.map((s) => s.title)).size;

  return (
    <div className="space-y-12">
      {past.length > 0 && (
        <p className="font-display max-w-[30ch] text-3xl leading-tight">
          You&apos;ve been to <span className="bg-[var(--gold)] px-1.5">{past.length}</span> screening{past.length === 1 ? "" : "s"} at the Royale
          {distinctTitles !== past.length ? ` (${distinctTitles} different films)` : ""}.
        </p>
      )}

      <section>
        <h2 className="font-display mb-4 text-2xl">Upcoming</h2>
        {upcoming.length === 0 ? (
          <Empty>
            No tickets for upcoming screenings.{" "}
            <Link href="/showtimes" className="font-bold text-[var(--accent)] hover:underline">
              See showtimes
            </Link>
          </Empty>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {upcoming.map((s) => (
              <TicketStub key={s.bookingId} s={s} />
            ))}
          </div>
        )}
      </section>

      {[...byYear.entries()].map(([year, list]) => (
        <section key={year}>
          <h2 className="font-display mb-4 flex items-baseline gap-3 text-2xl">
            {year} <span className="spec-code">{list.length} screening{list.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {list.map((s) => (
              <TicketStub key={s.bookingId} s={s} past />
            ))}
          </div>
        </section>
      ))}

      {past.length === 0 && upcoming.length === 0 && <p className="text-[15px] text-[var(--muted)]">Screenings you buy tickets for while signed in to this account show up here.</p>}
    </div>
  );
}
