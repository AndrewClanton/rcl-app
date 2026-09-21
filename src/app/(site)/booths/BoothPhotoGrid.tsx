"use client";

import Image from "next/image";
import type { Booth } from "@/lib/types";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function BoothPhotoGrid({
  booths,
  selectedId,
  bookedIds,
  onSelect,
}: {
  booths: Booth[];
  selectedId: string | null;
  bookedIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {booths.map((b) => {
        const selected = b.id === selectedId;
        const booked = bookedIds.has(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b.id)}
            className="panel relative flex flex-col overflow-hidden bg-[var(--surface)] text-left transition-transform hover:-translate-y-0.5"
            style={selected ? { boxShadow: "4px 4px 0 var(--accent)", borderColor: "var(--accent)" } : undefined}
            aria-pressed={selected}
          >
            <div className="relative aspect-[4/3] w-full bg-[var(--surface-hover)]">
              {b.photo_url ? (
                <Image src={b.photo_url} alt={b.label} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[var(--muted)]">
                  <span className="text-2xl">🛋️</span>
                  <span className="text-xs">Photo coming soon</span>
                </div>
              )}
              {booked && <span className="stamp-tag stamp-tag-accent absolute top-2 left-2">Booked today</span>}
            </div>
            <div className="flex flex-1 flex-col gap-0.5 p-3">
              <div className="font-display text-base leading-tight">{b.label}</div>
              <div className="text-xs text-[var(--muted)]">Seats up to {b.capacity}</div>
              <div className="mt-1 text-sm font-bold text-[var(--accent)]">{money(b.reservation_fee)}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
