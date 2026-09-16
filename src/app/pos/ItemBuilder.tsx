"use client";

import { useState } from "react";
import type { MenuItem, Recipe } from "@/lib/types";

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
      initial[g.key] = g.type === "single" && g.options[0] ? [g.options[0].name] : [];
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
          <div className="label-xs mb-1.5">
            {g.label} {g.type === "single" ? "(choose 1)" : "(optional)"}
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
          <button className="btn-primary" onClick={handleAdd}>
            Add to order
          </button>
        </div>
      </div>
    </div>
  );
}
