"use client";

import type { Booth } from "@/lib/types";

// Hand-drawn schematic of the venue's floor plan. The 8 booth footprints
// below (HIT_BOXES) are not eyeballed -- they're the exact pixel bounding
// boxes of the 8 red rectangles Andrew drew directly over the real floor
// plan photo, extracted with a small Node script (nearest-center pixel
// assignment + line-density filtering to ignore stray anti-aliased pixels,
// see the conversation this was built in) rather than read off the image
// by eye. Furniture inside each box is still hand-drawn, but its footprint
// now matches the real photo instead of an estimate. Keyed by booth label
// -- a booth renamed in /admin/booths needs its key updated here too.

const INK = "var(--foreground)";
const WOOD = "#a8763e";

// Tufted/diamond-stitch accent chairs (back booth, pinball, window booth) --
// rotated hard like the photo's scattered swivel chairs, with a crosshatch
// hinting at the quilted fabric instead of a flat fill.
function TuftedChair({ x, y, size, rotate = 0, stroke, dark = false }: { x: number; y: number; size: number; rotate?: number; stroke: string; dark?: boolean }) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const inset = size * 0.22;
  return (
    <g transform={`rotate(${rotate} ${cx} ${cy})`}>
      <rect x={x} y={y} width={size} height={size} rx={size * 0.16} fill={dark ? "var(--foreground)" : "var(--surface)"} stroke={stroke} strokeWidth={2.25} />
      <path
        d={`M ${x + inset} ${y + size / 2} L ${x + size / 2} ${y + inset} L ${x + size - inset} ${y + size / 2} L ${x + size / 2} ${y + size - inset} Z`}
        fill="none"
        stroke={dark ? "var(--background)" : stroke}
        strokeWidth={1.1}
        opacity={0.5}
      />
    </g>
  );
}

// Plain accent chairs (middle booth) -- smaller, barely rotated, no
// tufting -- reads as a simpler pair of chairs rather than the lounge
// swivel chairs elsewhere.
function SimpleChair({ x, y, size, rotate = 0, stroke }: { x: number; y: number; size: number; rotate?: number; stroke: string }) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  return (
    <g transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}>
      <rect x={x} y={y} width={size} height={size} rx={size * 0.4} fill="var(--surface)" stroke={stroke} strokeWidth={2} />
      <circle cx={cx} cy={y + size * 0.32} r={size * 0.14} fill="none" stroke={stroke} strokeWidth={1.2} opacity={0.55} />
    </g>
  );
}

function Couch({ x, y, w, h, rotate = 0, stroke, dark = false }: { x: number; y: number; w: number; h: number; rotate?: number; stroke: string; dark?: boolean }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const horizontal = w >= h;
  const seams = horizontal ? [x + w / 3, x + (2 * w) / 3] : [y + h / 3, y + (2 * h) / 3];
  return (
    <g transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={dark ? "var(--foreground)" : "var(--surface)"} stroke={stroke} strokeWidth={2.25} />
      {seams.map((s, i) =>
        horizontal ? (
          <line key={i} x1={s} y1={y + 5} x2={s} y2={y + h - 5} stroke={dark ? "var(--background)" : stroke} strokeWidth={1} opacity={0.4} />
        ) : (
          <line key={i} x1={x + 5} y1={s} x2={x + w - 5} y2={s} stroke={dark ? "var(--background)" : stroke} strokeWidth={1} opacity={0.4} />
        ),
      )}
    </g>
  );
}

function LBench({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return <path d={`M ${x} ${y} h 34 v 42 h 78 v 34 h -112 Z`} fill="var(--surface)" stroke={stroke} strokeWidth={2.25} strokeLinejoin="round" />;
}

function TableProp({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={3} fill={WOOD} stroke={INK} strokeWidth={1.25} />;
}

function Tv({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={90} height={86} rx={3} fill={INK} />
      <rect x={x + 6} y={y + 6} width={78} height={64} rx={1} fill="var(--background)" opacity={0.15} />
      <rect x={x + 32} y={y + 86} width={26} height={9} fill={INK} />
    </g>
  );
}

function PinballCabinet({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <g>
      <rect x={x} y={y} width={32} height={102} rx={4} fill="var(--surface)" stroke={stroke} strokeWidth={2.25} />
      <rect x={x + 5} y={y + 6} width={22} height={24} rx={2} fill={INK} opacity={0.75} />
      <line x1={x + 6} y1={y + 42} x2={x + 26} y2={y + 42} stroke={stroke} strokeWidth={1.25} opacity={0.4} />
      <line x1={x + 6} y1={y + 58} x2={x + 26} y2={y + 58} stroke={stroke} strokeWidth={1.25} opacity={0.4} />
      <line x1={x + 6} y1={y + 74} x2={x + 26} y2={y + 74} stroke={stroke} strokeWidth={1.25} opacity={0.4} />
    </g>
  );
}

function Jukebox({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <g>
      <path d={`M ${x} ${y + 30} v -16 a 12 12 0 0 1 24 0 v 16 Z`} fill="var(--gold)" stroke={stroke} strokeWidth={1.75} />
      <rect x={x} y={y + 12} width={24} height={24} rx={3} fill="var(--surface)" stroke={stroke} strokeWidth={1.75} />
    </g>
  );
}

function Ottoman({ x, y, size, stroke }: { x: number; y: number; size: number; stroke: string }) {
  return <rect x={x} y={y} width={size} height={size} rx={5} fill={WOOD} stroke={stroke} strokeWidth={1.75} opacity={0.85} />;
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
  x1?: number;
  y1?: number;
  x2: number;
  y2: number;
  label: string;
  anchor?: "start" | "end" | "middle";
  accent?: boolean;
}) {
  return (
    <g>
      {x1 !== undefined && y1 !== undefined && (
        <>
          <line x1={x1} y1={y1} x2={x2} y2={y2 + 3} stroke="var(--muted)" strokeWidth={1} />
          <circle cx={x1} cy={y1} r={2.25} fill="var(--muted)" />
        </>
      )}
      <text x={x2} y={y2} textAnchor={anchor} className="font-display" fontSize="12" fill={accent ? "var(--accent)" : "var(--foreground)"}>
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

// Exact pixel bounding boxes of the hand-drawn red rectangles (see the note
// above) -- this is what makes the map line up with the real room, and is
// also each booth's clickable hit area.
const HIT_BOXES: Record<LayoutKey, { x: number; y: number; w: number; h: number }> = {
  "Back Booth": { x: 8, y: 9, w: 208, h: 158 },
  "Juke Box Booth": { x: 66, y: 141, w: 155, h: 160 },
  "Double Booth (Right)": { x: 72, y: 297, w: 154, h: 118 },
  "Double Booth (Left)": { x: 70, y: 414, w: 156, h: 97 },
  "Pinball Booth": { x: 256, y: 308, w: 134, h: 158 },
  "Middle Booth": { x: 249, y: 520, w: 108, h: 123 },
  "Front Booth": { x: 139, y: 629, w: 158, h: 133 },
  "Window Booth": { x: 298, y: 616, w: 200, h: 149 },
};

function BoothFurniture({ layoutKey, stroke }: { layoutKey: LayoutKey; stroke: string }) {
  switch (layoutKey) {
    case "Back Booth":
      // Box: (8,9) 208x158. TV sits in the top-left corner; three tufted
      // chairs cascade down toward the bottom-right of the box.
      return (
        <>
          <TuftedChair x={120} y={16} size={56} rotate={33} stroke={stroke} />
          <TuftedChair x={112} y={72} size={52} rotate={26} stroke={stroke} />
          <TuftedChair x={140} y={122} size={48} rotate={18} stroke={stroke} />
        </>
      );
    case "Juke Box Booth":
      // Box: (66,141) 155x160.
      return (
        <>
          <Jukebox x={82} y={156} stroke={stroke} />
          <TuftedChair x={92} y={196} size={54} rotate={-10} stroke={stroke} dark />
        </>
      );
    case "Double Booth (Right)":
      // Box: (72,297) 154x118 -- L-bench plus its wood table.
      return (
        <>
          <LBench x={78} y={303} stroke={stroke} />
          <TableProp x={78} y={387} w={92} h={22} />
        </>
      );
    case "Double Booth (Left)":
      // Box: (70,414) 156x97 -- L-bench only, no table (matches the photo).
      return <LBench x={76} y={418} stroke={stroke} />;
    case "Pinball Booth":
      // Box: (256,308) 134x158 -- just the seating (chair + loveseat). The
      // pinball machines themselves aren't part of the reservable seat, so
      // they're drawn as a landmark outside the clickable box.
      return (
        <>
          <TuftedChair x={264} y={318} size={46} rotate={-16} stroke={stroke} />
          <Couch x={278} y={368} w={88} h={88} rotate={-2} stroke={stroke} />
        </>
      );
    case "Middle Booth":
      // Box: (249,520) 108x123 -- two facing chairs near the top of the box.
      return (
        <>
          <SimpleChair x={256} y={532} size={36} rotate={16} stroke={stroke} />
          <SimpleChair x={296} y={532} size={36} rotate={-16} stroke={stroke} />
        </>
      );
    case "Window Booth":
      // Box: (298,616) 200x149 -- sunlit alcove: chair top, dark couch
      // bottom-left, wood table, chair right.
      return (
        <>
          <rect x={298} y={616} width={200} height={149} rx={8} fill="var(--gold)" opacity={0.1} />
          <rect x={298} y={616} width={200} height={149} rx={8} fill="none" stroke={stroke} strokeWidth={1.75} strokeDasharray="6 4" opacity={0.45} />
          <TuftedChair x={312} y={626} size={34} rotate={8} stroke={stroke} />
          <Couch x={304} y={672} w={92} h={66} rotate={-4} stroke={stroke} dark />
          <TableProp x={392} y={686} w={58} h={32} />
          <TuftedChair x={448} y={654} size={42} rotate={12} stroke={stroke} />
        </>
      );
    case "Front Booth":
      // Box: (139,629) 158x133 -- couch plus a small ottoman.
      return (
        <>
          <Couch x={148} y={650} w={116} h={46} stroke={stroke} />
          <Ottoman x={176} y={706} size={34} stroke={stroke} />
        </>
      );
  }
}

function PinballMachines({ x, y, stroke }: { x: number; y: number; stroke: string }) {
  return (
    <g opacity={0.7}>
      <PinballCabinet x={x} y={y} stroke={stroke} />
      <PinballCabinet x={x + 40} y={y} stroke={stroke} />
    </g>
  );
}

// (x1,y1) is the leader's dot near the furniture; omit it to place the
// label directly beside the cluster with no line, matching the source
// photo, which only draws an arrow for some booths.
const LEADER_POS: Record<LayoutKey, { x1?: number; y1?: number; x2: number; y2: number; anchor?: "start" | "end" | "middle" }> = {
  "Back Booth": { x2: 130, y2: 190, anchor: "start" },
  "Juke Box Booth": { x1: 108, y1: 220, x2: 100, y2: 284, anchor: "start" },
  "Double Booth (Right)": { x1: 92, y1: 350, x2: 145, y2: 362, anchor: "start" },
  "Double Booth (Left)": { x1: 92, y1: 456, x2: 145, y2: 456, anchor: "start" },
  "Pinball Booth": { x1: 322, y1: 400, x2: 322, y2: 452, anchor: "middle" },
  "Middle Booth": { x2: 303, y2: 578, anchor: "middle" },
  "Window Booth": { x1: 400, y1: 630, x2: 450, y2: 610, anchor: "start" },
  "Front Booth": { x1: 220, y1: 674, x2: 60, y2: 674, anchor: "start" },
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
      <svg viewBox="0 0 757 768" className="w-full" role="group" aria-label="Booth floor plan — click a booth to reserve it">
        {/* Room silhouette -- an L-shape with the restrooms notched out of
            the top right and a step out toward the concession stand, traced
            from the venue's floor plan rather than a plain rectangle. Wall
            positions are set just outside the verified booth boxes. */}
        <path
          d="M 2 2 H 236 V 300 H 500 V 442 H 700 V 766 H 2 Z"
          fill="none"
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Context-only landmarks, not clickable */}
        <g opacity="0.55">
          <rect x="246" y="15" width="244" height="278" rx="2" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x="368" y="70" textAnchor="middle" className="font-mono" fontSize="13" fill="var(--muted)">
            RESTROOMS
          </text>

          <text x="600" y="395" textAnchor="middle" className="font-mono" fontSize="11" fill="var(--muted)">
            CONCESSION
          </text>
          <text x="600" y="409" textAnchor="middle" className="font-mono" fontSize="11" fill="var(--muted)">
            &amp; TICKETS
          </text>

          <text x="600" y="700" textAnchor="middle" className="font-mono" fontSize="12" fill="var(--muted)">
            ENTRANCE →
          </text>
        </g>

        <Tv x={8} y={9} />
        <PinballMachines x={396} y={318} stroke={INK} />

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
