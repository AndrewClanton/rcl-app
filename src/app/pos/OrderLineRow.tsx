"use client";

import DrinkIcon from "@/components/bar/DrinkIcon";
import type { IconSpec } from "@/lib/bar/icons";
import { DOUBLE, NEAT, ROCKS, isServeMod, plus, type Serve } from "@/lib/bar/double";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const SERVE_CHIP: Record<Serve, string> = { neat: "Neat", rocks: "Rocks" };
const SERVE_NAME: Record<Serve, string> = { neat: NEAT, rocks: ROCKS };

// One line on the order: − qty +, its name (and a drink's icon), its
// choices, its price, remove. One compact row per line, so a longer order
// still fits the iPad without scrolling much. A drink that can be a double
// gets a one-tap "Double" chip (lib/bar/double.ts): on, the line reads
// "Old fashioned · Double" and its price has the upcharge in it. A Liquor
// shot also gets "Neat" and "Rocks" chips, one choice (off, Neat or
// Rocks): "Call shot · Neat", a 2 oz pour at the shot price + $2. The chips
// take the line's whole width under it, so all three fit on one row.
export default function OrderLineRow({
  line,
  icon,
  double,
  serve,
  freeToday,
  comp,
  onLess,
  onMore,
  onRemove,
  onDouble,
  onServe,
}: {
  line: { name: string; qty: number; unit: number; mods: string[] };
  icon?: IconSpec | null;
  double?: { on: boolean; upcharge: number } | null; // null: this line can't be one
  serve?: { value: Serve | null; upcharge: number } | null; // null: this line can't be poured neat or on the rocks
  freeToday?: boolean; // the Insiders+ daily coffee is this line
  // An organization comp on this line (lib/orgs.ts): its name, e.g. "Easter Seals".
  comp?: string | null;
  onLess: () => void;
  onMore: () => void;
  onRemove: () => void;
  onDouble?: () => void;
  onServe?: (serve: Serve | null) => void;
}) {
  const doubled = !!double?.on;
  const served = serve?.value ?? null;
  // "Double", "Neat" and "On the rocks" show in the name, not again with the choices.
  const mods = line.mods.filter((m) => !(doubled && m === DOUBLE) && !(served && isServeMod(m)));
  const chips = (double && onDouble) || (serve && onServe);
  const chip = (on: boolean) => `chip min-h-8 shrink-0 whitespace-nowrap !px-2.5 !py-0.5 !text-xs font-bold ${on ? "chip-selected" : ""}`;
  return (
    <div
      className="card-flat grid items-center gap-x-2 gap-y-1 px-2 py-1.5"
      style={{ gridTemplateColumns: `36px 20px 36px ${icon ? "30px " : ""}minmax(0,1fr) auto 36px` }}
    >
      <button className="h-9 w-9 shrink-0 rounded-md border text-base" style={{ borderColor: "var(--border)", color: "var(--foreground)" }} onClick={onLess} aria-label={`One less ${line.name}`}>
        −
      </button>
      <span className="w-5 shrink-0 text-center text-sm font-bold" style={{ color: "var(--foreground)" }}>
        {line.qty}
      </span>
      <button className="h-9 w-9 shrink-0 rounded-md border text-base" style={{ borderColor: "var(--border)", color: "var(--foreground)" }} onClick={onMore} aria-label={`One more ${line.name}`}>
        +
      </button>
      {icon && (
        <span className="shrink-0" style={{ color: "var(--foreground)" }}>
          <DrinkIcon spec={icon} size={30} />
        </span>
      )}
      <div className="min-w-0">
        <div className={`text-sm font-medium ${doubled || served ? "line-clamp-2 leading-tight" : "truncate"}`} style={{ color: "var(--foreground)" }}>
          {line.name}
          {served && <span className="font-bold"> · {SERVE_NAME[served]}</span>}
          {doubled && <span className="font-bold"> · Double</span>}
        </div>
        {mods.length > 0 && !chips && (
          <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
            {mods.join(", ")}
          </div>
        )}
        {freeToday && (
          <div className="truncate text-xs font-bold" style={{ color: "var(--accent)" }}>
            ☕ {line.qty > 1 ? "One free today" : "Free today"}
          </div>
        )}
        {comp && (
          <div className="truncate text-xs font-bold" style={{ color: "var(--accent)" }}>
            {line.qty > 1 ? `One comped: ${comp}` : `Comp: ${comp}`}
          </div>
        )}
      </div>
      <span className="shrink-0 text-sm" style={{ color: "var(--foreground)" }}>
        {comp && line.qty === 1 ? (
          <>
            <s className="mr-1 text-xs" style={{ color: "var(--muted)" }}>
              {money(line.unit)}
            </s>
            {money(0)}
          </>
        ) : (
          money(line.unit * line.qty - (comp ? line.unit : 0))
        )}
      </span>
      <button className="h-9 w-9 shrink-0 rounded-md text-lg" style={{ color: "var(--danger-text)" }} onClick={onRemove} aria-label={`Remove ${line.name}`}>
        ×
      </button>
      {chips && (
        // The whole width of the line, so a shot's three chips and its
        // choice fit on one row.
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" style={{ gridColumn: "1 / -1" }}>
          {serve &&
            onServe &&
            (["neat", "rocks"] as const).map((s) => (
              <button
                key={s}
                className={chip(served === s)}
                onClick={() => onServe(served === s ? null : s)}
                aria-pressed={served === s}
                aria-label={served === s ? `${line.name} is ${SERVE_NAME[s].toLowerCase()} (${plus(serve.upcharge)} each). Tap to make it a plain shot.` : `Pour ${line.name} ${SERVE_NAME[s].toLowerCase()}, ${plus(serve.upcharge)} each`}
              >
                {served === s ? "✓ " : ""}
                {SERVE_CHIP[s]} {plus(serve.upcharge)}
              </button>
            ))}
          {double && onDouble && (
            <button
              className={chip(doubled)}
              onClick={onDouble}
              aria-pressed={doubled}
              aria-label={doubled ? `${line.name} is a double (${plus(double.upcharge)} each). Tap to make it a single.` : `Make ${line.name} a double, ${plus(double.upcharge)} each`}
            >
              {doubled ? "✓ " : ""}Double {plus(double.upcharge)}
            </button>
          )}
          {mods.length > 0 && (
            <span className="max-w-full shrink-0 truncate text-xs" style={{ color: "var(--muted)" }}>
              {mods.join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
