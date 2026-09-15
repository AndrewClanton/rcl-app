import Link from "next/link";
import { getUpcomingScreenings } from "@/lib/data/screenings";

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
    <div className="space-y-10">
      <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-8 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-3xl font-semibold">Movies, food, and drinks in one place.</h1>
        <p className="mt-2 max-w-2xl text-neutral-600 dark:text-neutral-400">
          Royale Cinema Lounge is a dine-in cinema and bar in Joplin, MO. Grab a seat, order off the full menu, and catch a show.
        </p>
        <div className="mt-5 flex gap-3">
          <Link href="/showtimes" className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            See showtimes
          </Link>
          <Link href="/menu" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700">
            View menu
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Coming up</h2>
          <Link href="/showtimes" className="text-sm text-neutral-500 hover:underline">
            See all showtimes →
          </Link>
        </div>
        {screenings.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500 dark:border-neutral-800">
            No screenings scheduled yet — check back soon.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {screenings.map((s) => (
              <div key={s.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="font-medium">{s.movie.title}</div>
                <div className="mt-1 text-sm text-neutral-500">{formatShowtime(s.starts_at)}</div>
                <div className="text-sm text-neutral-500">{s.room.name}</div>
                <div className="mt-2 text-sm font-medium">${s.ticket_price.toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
