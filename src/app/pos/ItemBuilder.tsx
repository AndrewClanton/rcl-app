"use client";

import { useState } from "react";
import type { MenuItem, Recipe } from "@/lib/types";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

// A drink made to a recipe (more than one thing in it, or steps to follow)
// opens here even with nothing to choose, so the bartender sees its recipe
// card. Anything else with nothing to choose goes straight on the order
// with one tap (PosApp), a beer or a single pour included.
export function needsRecipeCard(item: MenuItem, recipe: Recipe | null): boolean {
  return item.is_alcohol && !!recipe && (recipe.ingredients.length > 1 || !!recipe.instructions?.trim());
}

export interface BuiltLine {
  menuItemId: string;
  name: string;
  unit: number;
  qty: number;
  mods: string[];
  isAlcohol: boolean;
}

export default function ItemBuilder({
  item,
  recipe,
  onAdd,
  onCancel,
}: {
  item: MenuItem;
  recipe: Recipe | null;
  onAdd: (line: BuiltLine) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(1);
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

  function unitPrice() {
    let price = item.price;
    for (const g of item.modifier_groups) {
      for (const name of sel[g.key] ?? []) price += optionDelta(g.key, name);
    }
    return price;
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
    onAdd({ menuItemId: item.id, name: item.name, unit: unitPrice(), qty, mods, isAlcohol: item.is_alcohol });
  }

  const unanswered = item.modifier_groups.filter((g) => g.type === "single" && g.must_choose && !(sel[g.key] ?? []).length);

  return (
    <div className="card-flat" style={{ background: "var(--surface-hover)" }}>
      <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
        {item.name}
      </h3>
      <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
        Base {money(item.price)}
      </p>

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
          <div className="label-xs mb-1.5" style={g.must_choose && !(sel[g.key] ?? []).length ? { color: "var(--accent-text)" } : undefined}>
            {g.label} {g.type === "single" ? (g.must_choose ? "(pick one)" : "(choose 1)") : "(optional)"}
          </div>
          <div className="flex flex-wrap gap-2">
            {g.options.map((o) => {
              const picked = (sel[g.key] ?? []).includes(o.name);
              return (
                <button
                  key={o.id}
                  className={`chip min-h-11 !px-4 !text-sm ${picked ? "chip-selected font-bold" : ""}`}
                  aria-pressed={picked}
                  onClick={() => toggleOption(g.key, g.type, o.name)}
                >
                  {o.name}
                  {o.price_delta ? ` (+${money(o.price_delta).slice(1)})` : ""}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Pinned to the bottom of the menu panel, so Add to order is always
          on screen however many choices the item has. */}
      <div
        className="sticky bottom-0 -mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t px-4 py-3"
        style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}
      >
        <div className="flex items-center gap-2">
          <button
            className="h-11 w-11 rounded-lg border text-lg"
            style={{ borderColor: "var(--edge, var(--border))", color: "var(--foreground)" }}
            disabled={qty <= 1}
            onClick={() => setQty((q) => q - 1)}
            aria-label="One fewer"
          >
            −
          </button>
          <span className="min-w-[1.5rem] text-center font-medium tabular-nums" style={{ color: "var(--foreground)" }}>
            {qty}
          </span>
          <button
            className="h-11 w-11 rounded-lg border text-lg"
            style={{ borderColor: "var(--edge, var(--border))", color: "var(--foreground)" }}
            onClick={() => setQty((q) => q + 1)}
            aria-label="One more"
          >
            +
          </button>
        </div>
        <div className="text-xl font-semibold tabular-nums" style={{ color: "var(--accent-text)" }}>
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
