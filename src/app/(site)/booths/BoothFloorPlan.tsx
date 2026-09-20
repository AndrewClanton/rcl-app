"use client";

import type { Booth } from "@/lib/types";

// Hand-drawn schematic of the real booth room, traced from the venue's own
// floor plan photo -- furniture SHAPE (couch vs. L-bench vs. individual
// chairs) and position relative to the TV/pinball machines is what makes a
// booth recognizable to someone who's only been here once or twice, so
// this draws actual furniture silhouettes instead of a labeled grid of
// identical boxes. Keyed by booth label -- a booth renamed in
// /admin/booths needs its key updated in BOOTH_LAYOUT below too.

const INK = "var(--foreground)";

function Couch({ x, y, w, h, rotate = 0, stroke, dark = false }: { x: number; y: number; w: number; h: number; rotate?: number; stroke: string; dark?: boolean }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const seam1 = x + w / 3;
  const seam2 = x + (2 * w) / 3;
  return (
    <g transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={9} fill={dark ? "var(--foreground)" : "var(--surface)"} stroke={stroke} strokeWidth={2.5} />
      <line x1={seam1} y1={y + 5} x2={seam1} y2={y + h - 5} stroke={dark ? "var(--background)" : stroke} strokeWidth={1} opacity={0.45} />
      <line x1={seam2} y1={y + 5} x2={seam2} y2={y + h - 5} stroke={dark ? "var(--background)" : stroke} strokeWidth={1} opacity={0.45} />
      <line x1={x + 5} y1={y + 6} x2={x + w - 5} y2={y + 6} stroke={dark ? "var(--background)" : stroke} strokeWidth={2} opacity={0.5} />
    </g>
  );
}

function Chair({ x, y, size, rotate = 0, stroke, dark = false }: { x: number; y: number; size: number; rotate?: number; stroke: string; dark?: boolean }) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  return (
    <g transform={`rotate(${rotate} ${cx} ${cy})`}>
      <rect x={x} y={y} width={size} height={size} rx={7} fill={dark ? "var(--foreground)" : "var(--surface)"} stroke={stroke} strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={size * 0.16} fill="none" stroke={dark ? "var(--background)" : stroke} strokeWidth={1.4} opacity={0.55} />
    </g>
  );
}

function LBench({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <path d={`M ${x} ${y} h 32 v 44 h 66 v 32 h -98 Z`} fill="var(--surface)" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" />
  );
}

function TableProp({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={4} fill="#a8763e" stroke={INK} strokeWidth={1.5} />;
}

function Tv({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={72} height={68} rx={4} fill={INK} />
      <rect x={x + 6} y={y + 6} width={60} height={48} rx={2} fill="var(--background)" opacity={0.14} />
      <rect x={x + 27} y={y + 68} width={18} height={9} fill={INK} />
    </g>
  );
}

function PinballCabinet({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <g>
      <rect x={x} y={y} width={30} height={90} rx={4} fill="var(--surface)" stroke={stroke} strokeWidth={2.5} />
      <rect x={x + 5} y={y + 6} width={20} height={22} rx={2} fill="var(--accent)" />
      <line x1={x + 6} y1={y + 40} x2={x + 24} y2={y + 40} stroke={stroke} strokeWidth={1.5} opacity={0.5} />
      <line x1={x + 6} y1={y + 55} x2={x + 24} y2={y + 55} stroke={stroke} strokeWidth={1.5} opacity={0.5} />
      <line x1={x + 6} y1={y + 70} x2={x + 24} y2={y + 70} stroke={stroke} strokeWidth={1.5} opacity={0.5} />
    </g>
  );
}

function Jukebox({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <g>
      <path d={`M ${x} ${y + 32} v -18 a 13 13 0 0 1 26 0 v 18 Z`} fill="var(--gold)" stroke={stroke} strokeWidth={2} />
      <rect x={x} y={y + 12} width={26} height={26} rx={3} fill="var(--surface)" stroke={stroke} strokeWidth={2} />
    </g>
  );
}

function Ottoman({ x, y, size, stroke }: { x: number; y: number; size: number; stroke: string }) {
  return <rect x={x} y={y} width={size} height={size} rx={6} fill="#a8763e" stroke={stroke} strokeWidth={2} opacity={0.85} />;
}

function Leader({
  x1,
  y1,
  x2,
  y2,
  label,
  anchor = "start",
  accent = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  anchor?: "start" | "end" | "middle";
  accent?: boolean;
}) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth={1} />
      <circle cx={x1} cy={y1} r={2.5} fill="var(--muted)" />
      <text x={x2} y={y2} textAnchor={anchor} className="font-display" fontSize="12.5" fill={accent ? "var(--accent)" : "var(--foreground)"}>
        {label}
      </text>
    </g>
  );
}

type LayoutKey =
  | "Back Booth"
  | "Juke Box Booth"
  | "Double Booth (Right)"
  | "Double Booth (Left)"
  | "Pinball Booth"
  | "Middle Booth"
  | "Window Booth"
  | "Front Booth";

// One hit-box per booth (a little larger than its furniture, so touch/click
// doesn't have to land pixel-perfect on a chair leg) and where its soft
// selection/hover highlight renders.
const HIT_BOXES: Record<LayoutKey, { x: number; y: number; w: number; h: number }> = {
  "Back Booth": { x: 95, y: 8, w: 155, h: 195 },
  "Juke Box Booth": { x: 55, y: 195, w: 95, h: 90 },
  "Double Booth (Right)": { x: 12, y: 288, w: 130, h: 100 },
  "Double Booth (Left)": { x: 12, y: 400, w: 130, h: 95 },
  "Pinball Booth": { x: 278, y: 300, w: 215, h: 165 },
  "Middle Booth": { x: 250, y: 505, w: 100, h: 65 },
  "Window Booth": { x: 250, y: 565, w: 235, h: 150 },
  "Front Booth": { x: 155, y: 590, w: 130, h: 65 },
};

function BoothFurniture({ layoutKey, stroke }: { layoutKey: LayoutKey; stroke: string }) {
  switch (layoutKey) {
    case "Back Booth":
      return (
        <>
          <Chair x={118} y={22} size={46} rotate={-12} stroke={stroke} />
          <Chair x={152} y={82} size={44} rotate={-8} stroke={stroke} />
          <Chair x={180} y={148} size={42} rotate={-4} stroke={stroke} />
        </>
      );
    case "Juke Box Booth":
      return (
        <>
          <Jukebox x={62} y={198} stroke={stroke} />
          <Chair x={78} y={232} size={44} rotate={-6} stroke={stroke} dark />
        </>
      );
    case "Double Booth (Right)":
      return (
        <>
          <LBench x={22} y={295} stroke={stroke} />
          <TableProp x={22} y={373} w={78} h={22} />
        </>
      );
    case "Double Booth (Left)":
      return <LBench x={22} y={407} stroke={stroke} />;
    case "Pinball Booth":
      return (
        <>
          <Chair x={288} y={318} size={42} rotate={-18} stroke={stroke} />
          <Couch x={318} y={342} w={78} h={78} rotate={-2} stroke={stroke} />
          <PinballCabinet x={410} y={305} stroke={stroke} />
          <PinballCabinet x={452} y={305} stroke={stroke} />
          <rect x={296} y={432} width={155} height={6} rx={3} fill="var(--gold)" opacity={0.7} />
        </>
      );
    case "Middle Booth":
      return (
        <>
          <Chair x={258} y={515} size={36} rotate={18} stroke={stroke} />
          <Chair x={302} y={515} size={36} rotate={-18} stroke={stroke} />
        </>
      );
    case "Window Booth":
      return (
        <>
          <rect x={252} y={567} width={230} height={146} rx={10} fill="var(--gold)" opacity={0.16} />
          <rect x={252} y={567} width={230} height={146} rx={10} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray="6 4" opacity={0.5} />
          <Couch x={268} y={640} w={98} h={68} rotate={-3} stroke={stroke} dark />
          <Chair x={288} y={585} size={34} rotate={4} stroke={stroke} />
          <TableProp x={352} y={648} w={60} h={34} />
          <Chair x={425} y={618} size={44} rotate={10} stroke={stroke} />
        </>
      );
    case "Front Booth":
      return (
        <>
          <Couch x={155} y={598} w={110} h={44} stroke={stroke} />
          <Ottoman x={190} y={648} size={32} stroke={stroke} />
        </>
      );
  }
}

// Dot (x1,y1) sits near the furniture; the label itself (x2,y2) sits in the
// open gap between the left-column booths and the middle features, mirroring
// how the venue's own floor plan calls out each booth with a leader line
// instead of a label sitting on top of the furniture.
const LEADER_POS: Record<LayoutKey, { x1: number; y1: number; x2: number; y2: number; anchor?: "start" | "end" | "middle" }> = {
  "Back Booth": { x1: 170, y1: 40, x2: 232, y2: 44, anchor: "start" },
  "Juke Box Booth": { x1: 100, y1: 245, x2: 150, y2: 240, anchor: "start" },
  "Double Booth (Right)": { x1: 120, y1: 335, x2: 150, y2: 335, anchor: "start" },
  "Double Booth (Left)": { x1: 120, y1: 445, x2: 150, y2: 445, anchor: "start" },
  "Pinball Booth": { x1: 355, y1: 415, x2: 300, y2: 500, anchor: "middle" },
  "Middle Booth": { x1: 280, y1: 528, x2: 225, y2: 540, anchor: "end" },
  "Window Booth": { x1: 440, y1: 590, x2: 565, y2: 555, anchor: "end" },
  "Front Booth": { x1: 190, y1: 612, x2: 20, y2: 580, anchor: "start" },
};

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
      <svg viewBox="0 0 620 745" className="w-full" role="group" aria-label="Booth floor plan — click a booth to reserve it">
        <rect x="8" y="4" width="565" height="700" rx="8" fill="var(--background)" stroke={INK} strokeWidth="2" />

        {/* Context-only landmarks, not clickable */}
        <g opacity="0.55">
          <rect x="305" y="30" width="205" height="130" rx="4" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="407" y="100" textAnchor="middle" className="font-mono" fontSize="13" fill="var(--muted)">
            RESTROOMS
          </text>

          <rect x="533" y="330" width="40" height="140" rx="4" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="553" y="400" textAnchor="middle" className="font-mono" fontSize="9.5" fill="var(--muted)" transform="rotate(90 553 400)">
            CONCESSION &amp; TICKETS
          </text>

          <text x="500" y="672" textAnchor="middle" className="font-mono" fontSize="12" fill="var(--muted)">
            ENTRANCE →
          </text>
        </g>

        <Tv x={16} y={4} />

        {(Object.keys(HIT_BOXES) as LayoutKey[]).map((key) => {
          const booth = boothByLabel.get(key);
          if (!booth) return null;
          const box = HIT_BOXES[key];
          const selected = booth.id === selectedId;
          const booked = bookedIds.has(booth.id);
          const stroke = selected ? "var(--accent)" : INK;
          return (
            <g
              key={key}
              tabIndex={0}
              role="button"
              aria-label={`${booth.label}, seats up to ${booth.capacity}, $${booth.reservation_fee.toFixed(2)}${booked ? ", has a booking today" : ""}`}
              className="group cursor-pointer focus:outline-none"
              onClick={() => onSelect(booth.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(booth.id);
                }
              }}
            >
              {/* soft highlight under the furniture (selected, or on hover/focus), plus the real hit-area */}
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx={14}
                fill="var(--gold)"
                opacity={selected ? 0.3 : 0}
                className="transition-opacity group-hover:opacity-15 group-focus:opacity-15"
              />
              <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />

              <BoothFurniture layoutKey={key} stroke={stroke} />

              {booked && (
                <circle cx={box.x + box.w - 10} cy={box.y + 10} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5">
                  <title>Booked at some point today</title>
                </circle>
              )}
            </g>
          );
        })}

        {(Object.keys(LEADER_POS) as LayoutKey[]).map((key) => {
          const booth = boothByLabel.get(key);
          if (!booth) return null;
          const pos = LEADER_POS[key];
          return <Leader key={key} {...pos} label={booth.label} accent={booth.id === selectedId} />;
        })}
      </svg>
      <p className="mt-2 text-center text-xs text-[var(--muted)]">
        Tap a booth to reserve it. <span className="text-[var(--accent)]">●</span> = has a booking today.
      </p>
    </div>
  );
}
