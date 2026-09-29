"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Screening } from "@/lib/types";

function formatShowtime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

// A public lobby TV with no login. The schedule comes from the server
// (which drops older MPLC titles) and is re-fetched every minute; the
// browser never reads the database itself, since movies and screenings
// aren't readable with the public key.
export default function BoxOfficeSignage({ initialScreenings: screenings }: { initialScreenings: Screening[] }) {
  const router = useRouter();
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const refresh = setInterval(() => router.refresh(), 60_000);
    const clockInterval = setInterval(() => setClock(new Date()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(clockInterval);
    };
  }, [router]);

  return (
    <div className="min-h-screen p-10" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="mb-8 flex items-baseline justify-between border-b-2 pb-4" style={{ borderColor: "var(--foreground)" }}>
        <h1 className="font-display text-4xl">ROYALE CINEMA LOUNGE</h1>
        <span className="font-mono text-2xl" style={{ color: "var(--muted)" }}>
          {clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}
        </span>
      </div>

      {screenings.length === 0 ? (
        <div className="mt-20 text-center text-2xl" style={{ color: "var(--muted)" }}>
          No screenings scheduled.
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {screenings.map((s) => (
            <div key={s.id} className="card">
              <div className="font-display text-2xl">{s.movie.title}</div>
              <div className="mt-2 text-xl font-bold" style={{ color: "var(--accent)" }}>
                {formatShowtime(s.starts_at)}
              </div>
              <div className="mt-1" style={{ color: "var(--muted)" }}>
                {s.room.name}
              </div>
              {s.movie.rating && <div className="stamp-tag stamp-tag-gold mt-3">{s.movie.rating}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
