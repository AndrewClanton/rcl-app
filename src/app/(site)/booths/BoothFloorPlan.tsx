"use client";

import type { Booth } from "@/lib/types";

// Static schematic of the real booth room, simplified from the venue's
// floor plan -- coordinates are hand-placed to roughly match where each
// booth actually sits (left wall top-to-bottom, then the cluster near the
// entrance), not traced pixel-for-pixel. Keyed by booth label, so a booth
// renamed in /admin/booths needs its key updated here too.
const ZONES: { key: string; x: number; y: number; w: number; h: number }[] = [
  { key: "Back Booth", x: 40, y: 40, w: 160, h: 100 },
  { key: "Juke Box Booth", x: 40, y: 155, w: 100, h: 80 },
  { key: "Double Booth (Right)", x: 40, y: 250, w: 160, h: 75 },
  { key: "Double Booth (Left)", x: 40, y: 340, w: 160, h: 75 },
  { key: "Pinball Booth", x: 300, y: 210, w: 220, h: 160 },
  { key: "Middle Booth", x: 260, y: 460, w: 110, h: 70 },
  { key: "Front Booth", x: 150, y: 545, w: 140, h: 85 },
  { key: "Window Booth", x: 390, y: 520, w: 230, h: 150 },
];

export default function BoothFloorPlan({
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
  const boothByLabel = new Map(booths.map((b) => [b.label, b]));

  return (
    <div className="panel overflow-hidden bg-[var(--surface)] p-3">
      <svg viewBox="0 0 700 700" className="w-full" role="group" aria-label="Booth floor plan — click a booth to reserve it">
        <rect x="20" y="20" width="660" height="660" rx="8" fill="var(--background)" stroke="var(--foreground)" strokeWidth="2" />

        {/* Context-only landmarks, not clickable */}
        <g opacity="0.55">
          <rect x="260" y="40" width="260" height="140" rx="4" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="390" y="115" textAnchor="middle" className="font-mono" fontSize="13" fill="var(--muted)">
            RESTROOMS
          </text>

          <rect x="560" y="250" width="100" height="110" rx="4" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="610" y="298" textAnchor="middle" className="font-mono" fontSize="10.5" fill="var(--muted)">
            <tspan x="610">CONCESSION</tspan>
            <tspan x="610" dy="14">&amp; TICKETS</tspan>
          </text>

          <text x="610" y="628" textAnchor="middle" className="font-mono" fontSize="12" fill="var(--muted)">
            ENTRANCE →
          </text>
        </g>

        {ZONES.map((z) => {
          const booth = boothByLabel.get(z.key);
          if (!booth) return null;
          const selected = booth.id === selectedId;
          const booked = bookedIds.has(booth.id);
          return (
            <g
              key={z.key}
              tabIndex={0}
              role="button"
              aria-label={`${booth.label}, seats up to ${booth.capacity}, $${booth.reservation_fee.toFixed(2)}${booked ? ", has a booking today" : ""}`}
              className="cursor-pointer focus:outline-none"
              onClick={() => onSelect(booth.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(booth.id);
                }
              }}
            >
              <rect
                x={z.x}
                y={z.y}
                width={z.w}
                height={z.h}
                rx="6"
                fill={selected ? "var(--gold)" : "var(--surface)"}
                stroke="var(--foreground)"
                strokeWidth={selected ? 3 : 2}
                className="transition-colors"
              />
              <text x={z.x + z.w / 2} y={z.y + z.h / 2 - 6} textAnchor="middle" className="font-display" fontSize="14" fill="var(--foreground)">
                {booth.label}
              </text>
              <text
                x={z.x + z.w / 2}
                y={z.y + z.h / 2 + 15}
                textAnchor="middle"
                className="font-mono"
                fontSize="11"
                fontWeight="bold"
                fill={selected ? "var(--foreground)" : "var(--accent)"}
              >
                ${booth.reservation_fee.toFixed(0)} · seats {booth.capacity}
              </text>
              {booked && (
                <circle cx={z.x + z.w - 12} cy={z.y + 12} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5">
                  <title>Booked at some point today</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-xs text-[var(--muted)]">
        Tap a booth to reserve it. <span className="text-[var(--accent)]">●</span> = has a booking today.
      </p>
    </div>
  );
}
