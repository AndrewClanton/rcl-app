"use client";

import { useState } from "react";
import type { MenuItem, Recipe } from "@/lib/types";
import DrinkIcon from "@/components/bar/DrinkIcon";
import type { IconSpec } from "@/lib/bar/icons";
import { DOUBLE, doubleUpcharge, plus, type DoubleContext, type DoubleSettings } from "@/lib/bar/double";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

export interface BuiltLine {
  menuItemId: string;
  name: string;
  unit: number;
  qty: number;
  mods: string[];
  isAlcohol: boolean;
}

// The choices sheet a menu button opens. A drink shows its icon large (so
// tapping its tile never makes it vanish), and one that can be a double
// gets a Double choice (lib/bar/double.ts): twice the spirit, its upcharge
// in the price, "Double" on the line.
export default function ItemBuilder({
  item,
  recipe,
  icon,
  double,
  onAdd,
  onCancel,
}: {
  item: MenuItem;
  recipe: Recipe | null;
  icon?: IconSpec | null;
  double?: { ctx: DoubleContext; settings: DoubleSettings; start: boolean } | null;
  onAdd: (line: BuiltLine) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [doubled, setDoubled] = useState(!!double?.start);
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const g of item.modifier_groups) {
      // A "must pick" group starts empty so nobody skips the question.
      initial[g.key] = g.type === "single" && !g.must_choose && g.options[0] ? [g.options[0].name] : [];
    }
    return initial;
  });

  function optionDelta(groupKey: string, name: string) {
    const group = item.modifier_groups.find((g) => g.key === groupKey);
    return group?.options.find((o) => o.name === name)?.price_delta ?? 0;
  }

  function singlePrice() {
    let price = item.price;
    for (const g of item.modifier_groups) {
      for (const name of sel[g.key] ?? []) price += optionDelta(g.key, name);
    }
    return price;
  }

  // What a double adds to the single (a shot's own price; a cocktail's by
  // its spirit), or null when it can't be one.
  const upcharge = double ? doubleUpcharge(singlePrice(), double.ctx, double.settings) : null;
  const isDoubled = doubled && upcharge !== null;

  function unitPrice() {
    const single = singlePrice();
    return isDoubled ? Math.round((single + upcharge!) * 100) / 100 : single;
  }

  function toggleOption(groupKey: string, type: "single" | "multi", name: string) {
    setSel((prev) => {
      if (type === "single") return { ...prev, [groupKey]: [name] };
      const current = prev[groupKey] ?? [];
      const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
      return { ...prev, [groupKey]: next };
    });
  }

  function handleAdd() {
    const mods: string[] = [];
    for (const g of item.modifier_groups) {
      for (const name of sel[g.key] ?? []) mods.push(name);
    }
    if (isDoubled) mods.push(DOUBLE);
    onAdd({ menuItemId: item.id, name: item.name, unit: unitPrice(), qty, mods, isAlcohol: item.is_alcohol });
  }

  const unanswered = item.modifier_groups.filter((g) => g.type === "single" && g.must_choose && !(sel[g.key] ?? []).length);

  return (
    <div className="card-flat" style={{ background: "var(--surface-hover)" }}>
      <div className="flex items-start gap-4">
        {icon && (
          <span className="shrink-0" style={{ color: "var(--foreground)" }}>
            <DrinkIcon spec={icon} size={120} label={item.name} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className={icon ? "font-display text-2xl leading-tight" : "text-lg font-semibold"} style={{ color: "var(--foreground)" }}>
            {item.name}
            {isDoubled && <span> · Double</span>}
          </h3>
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Base {money(item.price)}
          </p>
          {upcharge !== null && (
            <div className="mb-3">
              <button className={`chip min-h-11 !px-4 !text-sm font-bold ${isDoubled ? "chip-selected" : ""}`} aria-pressed={isDoubled} onClick={() => setDoubled(!isDoubled)}>
                {isDoubled ? "✓ " : ""}Double {plus(upcharge)}
              </button>
              <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                Twice the spirit; the mixers stay the same.
              </span>
            </div>
          )}
        </div>
      </div>

      {item.is_alcohol && recipe && (recipe.ingredients.length > 0 || recipe.instructions || recipe.glassware || recipe.garnish) && (
        <div className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <div className="eyebrow mb-2">Recipe</div>
          {recipe.ingredients.length > 0 && (
            <ul className="mb-2 space-y-0.5 text-sm" style={{ color: "var(--foreground)" }}>
              {recipe.ingredients.map((ri) => (
                <li key={ri.id} className="flex justify-between gap-3">
                  <span>{ri.ingredient_name}</span>
                  <span style={{ color: "var(--muted)" }}>
                    {ri.quantity} {unitLabel(ri.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(recipe.glassware || recipe.garnish) && (
            <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
              {recipe.glassware && <>Glass: {recipe.glassware}</>}
              {recipe.glassware && recipe.garnish && " · "}
              {recipe.garnish && <>Garnish: {recipe.garnish}</>}
            </div>
          )}
          {recipe.instructions && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {recipe.instructions}
            </p>
          )}
        </div>
      )}

      {item.modifier_groups.map((g) => (
        <div key={g.id} className="mb-3">
          <div className="label-xs mb-1.5" style={g.must_choose && !(sel[g.key] ?? []).length ? { color: "var(--accent)" } : undefined}>
            {g.label} {g.type === "single" ? (g.must_choose ? "(pick one)" : "(choose 1)") : "(optional)"}
          </div>
          <div className="flex flex-wrap gap-2">
            {g.options.map((o) => {
              const picked = (sel[g.key] ?? []).includes(o.name);
              return (
                <button key={o.id} className={picked ? "chip chip-selected" : "chip"} onClick={() => toggleOption(g.key, g.type, o.name)}>
                  {o.name}
                  {o.price_delta ? ` (+${money(o.price_delta).slice(1)})` : ""}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <button
            className="h-9 w-9 rounded-lg border text-base"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            disabled={qty <= 1}
            onClick={() => setQty((q) => q - 1)}
          >
            −
          </button>
          <span className="min-w-[1.5rem] text-center font-medium" style={{ color: "var(--foreground)" }}>
            {qty}
          </span>
          <button
            className="h-9 w-9 rounded-lg border text-base"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            onClick={() => setQty((q) => q + 1)}
          >
            +
          </button>
        </div>
        <div className="text-xl font-semibold" style={{ color: "var(--accent)" }}>
          {money(unitPrice() * qty)}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={unanswered.length > 0} onClick={handleAdd}>
            {unanswered.length > 0 ? `Pick a ${unanswered[0].label.toLowerCase()}` : "Add to order"}
          </button>
        </div>
      </div>
    </div>
  );
}
