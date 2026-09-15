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
    <div className="min-h-screen bg-black p-10 text-white">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-4xl font-semibold">Royale Cinema Lounge</h1>
        <span className="text-2xl text-neutral-400">{clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
      </div>

      {screenings.length === 0 ? (
        <div className="mt-20 text-center text-2xl text-neutral-500">No screenings scheduled.</div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {screenings.map((s) => (
            <div key={s.id} className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
              <div className="text-2xl font-semibold">{s.movie.title}</div>
              <div className="mt-2 text-xl text-amber-400">{formatShowtime(s.starts_at)}</div>
              <div className="mt-1 text-neutral-400">{s.room.name}</div>
              {s.movie.rating && <div className="mt-3 inline-block rounded border border-neutral-700 px-2 py-0.5 text-sm text-neutral-400">{s.movie.rating}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
