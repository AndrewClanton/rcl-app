"use client";

import DrinkIcon from "@/components/bar/DrinkIcon";
import type { IconSpec } from "@/lib/bar/icons";
import { DOUBLE, plus } from "@/lib/bar/double";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// One line on the order: − qty +, its name (and a drink's icon), its
// choices, its price, remove. One compact row per line, so a longer order
// still fits the iPad without scrolling much. A drink that can be a double
// gets a one-tap "Double" chip (lib/bar/double.ts): on, the line reads
// "Old fashioned · Double" and its price has the upcharge in it.
export default function OrderLineRow({
  line,
  icon,
  double,
  freeToday,
  onLess,
  onMore,
  onRemove,
  onDouble,
}: {
  line: { name: string; qty: number; unit: number; mods: string[] };
  icon?: IconSpec | null;
  double?: { on: boolean; upcharge: number } | null; // null: this line can't be one
  freeToday?: boolean; // the Insiders+ daily coffee is this line
  onLess: () => void;
  onMore: () => void;
  onRemove: () => void;
  onDouble?: () => void;
}) {
  const doubled = !!double?.on;
  // "Double" shows in the name, not again with the choices.
  const mods = doubled ? line.mods.filter((m) => m !== DOUBLE) : line.mods;
  return (
    <div className="card-flat flex items-center gap-2 px-2 py-1.5">
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
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${doubled ? "line-clamp-2 leading-tight" : "truncate"}`} style={{ color: "var(--foreground)" }}>
          {line.name}
          {doubled && <span className="font-bold"> · Double</span>}
        </div>
        {(mods.length > 0 || (double && onDouble)) && (
          <div className="flex min-w-0 items-center gap-2">
            {/* Under the name, so the name keeps its room. */}
            {double && onDouble && (
              <button
                className={`chip min-h-8 shrink-0 whitespace-nowrap !px-2.5 !py-0.5 !text-xs font-bold ${doubled ? "chip-selected" : ""}`}
                onClick={onDouble}
                aria-pressed={doubled}
                aria-label={doubled ? `${line.name} is a double (${plus(double.upcharge)} each). Tap to make it a single.` : `Make ${line.name} a double, ${plus(double.upcharge)} each`}
              >
                {doubled ? "✓ " : ""}Double {plus(double.upcharge)}
              </button>
            )}
            {mods.length > 0 && (
              <span className="min-w-0 truncate text-xs" style={{ color: "var(--muted)" }}>
                {mods.join(", ")}
              </span>
            )}
          </div>
        )}
        {freeToday && (
          <div className="truncate text-xs font-bold" style={{ color: "var(--accent)" }}>
            ☕ {line.qty > 1 ? "One free today" : "Free today"}
          </div>
        )}
      </div>
      <span className="shrink-0 text-sm" style={{ color: "var(--foreground)" }}>
        {money(line.unit * line.qty)}
      </span>
      <button className="h-9 w-9 shrink-0 rounded-md text-lg" style={{ color: "var(--danger-text)" }} onClick={onRemove} aria-label={`Remove ${line.name}`}>
        ×
      </button>
    </div>
  );
}
