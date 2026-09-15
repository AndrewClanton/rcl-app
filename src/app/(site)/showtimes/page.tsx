import Link from "next/link";
import { getUpcomingScreenings } from "@/lib/data/screenings";
import type { Screening } from "@/lib/types";

export const dynamic = "force-dynamic";

function dateKey(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
  const screenings = await getUpcomingScreenings();
  const groups = groupByDate(screenings);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Showtimes</h1>
      {screenings.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500 dark:border-neutral-800">
          No screenings scheduled yet — check back soon.
        </div>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([date, list]) => (
            <div key={date}>
              <h2 className="mb-3 text-lg font-medium">{date}</h2>
              <div className="space-y-3">
                {list.map((s) => (
                  <Link
                    key={s.id}
                    href={`/showtimes/${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800"
                  >
                    <div>
                      <div className="font-medium">{s.movie.title}</div>
                      <div className="text-sm text-neutral-500">
                        {timeLabel(s.starts_at)} · {s.room.name}
                        {s.movie.runtime_minutes ? ` · ${s.movie.runtime_minutes} min` : ""}
                        {s.movie.rating ? ` · ${s.movie.rating}` : ""}
                      </div>
                    </div>
                    <div className="text-sm font-medium">${s.ticket_price.toFixed(2)}</div>
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
