"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Screening } from "@/lib/types";

function formatShowtime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

async function fetchUpcoming(supabase: ReturnType<typeof createClient>): Promise<Screening[]> {
  const { data } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(12);
  return (data ?? []) as unknown as Screening[];
}

export default function BoxOfficeSignage({ initialScreenings }: { initialScreenings: Screening[] }) {
  const [screenings, setScreenings] = useState(initialScreenings);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("box-office-screenings")
      .on("postgres_changes", { event: "*", schema: "public", table: "screenings" }, async () => {
        setScreenings(await fetchUpcoming(supabase));
      })
      .subscribe();

    const clockInterval = setInterval(() => setClock(new Date()), 1000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(clockInterval);
    };
  }, []);

  return (
    <div className="min-h-screen p-10" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="mb-8 flex items-baseline justify-between border-b-2 pb-4" style={{ borderColor: "var(--foreground)" }}>
        <h1 className="font-display text-4xl">ROYALE CINEMA LOUNGE</h1>
        <span className="font-mono text-2xl" style={{ color: "var(--muted)" }}>
          {clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
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
