import Link from "next/link";
import { requireMember } from "@/lib/member-auth";
import { getMemberScreenings, yearOf, type MemberScreening } from "@/lib/data/member-account";
import MoviePoster from "@/components/MoviePoster";
import { showtime } from "../format";

export const metadata = { title: "Movies" };

export default async function MoviesPage() {
  const member = await requireMember();
  const { upcoming, past } = await getMemberScreenings(member.id);
  const byYear = new Map<number, MemberScreening[]>();
  for (const s of past) {
    const y = yearOf(s.startsAt);
    byYear.set(y, [...(byYear.get(y) ?? []), s]);
  }
  const distinctTitles = new Set(past.map((s) => s.title)).size;

  return (
    <div className="space-y-10">
      {past.length > 0 && (
        <p className="font-display text-2xl leading-snug">
          You&apos;ve been to {past.length} screening{past.length === 1 ? "" : "s"} at the Royale
          {distinctTitles !== past.length ? ` (${distinctTitles} different films)` : ""}.
        </p>
      )}

      <section>
        <h2 className="font-display mb-3 text-xl">Upcoming</h2>
        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">
            No tickets for upcoming screenings.{" "}
            <Link href="/showtimes" className="font-bold text-[var(--accent)] hover:underline">
              See showtimes
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((s) => (
              <ScreeningCard key={s.bookingId} s={s} highlight />
            ))}
          </div>
        )}
      </section>

      {[...byYear.entries()].map(([year, list]) => (
        <section key={year}>
          <h2 className="font-display mb-3 text-xl">
            {year} <span className="text-base text-[var(--muted)]">· {list.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((s) => (
              <ScreeningCard key={s.bookingId} s={s} />
            ))}
          </div>
        </section>
      ))}

      {past.length === 0 && upcoming.length === 0 && (
        <p className="text-sm text-[var(--muted)]">Screenings you buy tickets for while signed in to this account show up here.</p>
      )}
    </div>
  );
}

function ScreeningCard({ s, highlight }: { s: MemberScreening; highlight?: boolean }) {
  return (
    <Link
      href={`/account/purchases/ticket/${s.bookingId}`}
      className={`flex items-center gap-4 rounded-xl border p-3 transition-colors hover:bg-[var(--surface-hover)] ${
        highlight ? "border-2 border-[var(--foreground)] bg-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <div className="w-14 shrink-0">
        <MoviePoster posterUrl={s.posterUrl} title={s.title} sizes="56px" />
      </div>
      <div className="min-w-0">
        <div className="truncate font-bold">{s.title}</div>
        <div className={`text-sm ${highlight ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{showtime(s.startsAt)}</div>
        <div className="text-xs text-[var(--muted)]">
          {s.room} · {s.quantity} ticket{s.quantity === 1 ? "" : "s"}
        </div>
      </div>
    </Link>
  );
}
