"use client";

import { useState } from "react";
import type { MenuItem } from "@/lib/types";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export interface BuiltLine {
  menuItemId: string;
  name: string;
  unit: number;
  qty: number;
  mods: string[];
  isAlcohol: boolean;
}

export default function ItemBuilder({ item, onAdd, onCancel }: { item: MenuItem; onAdd: (line: BuiltLine) => void; onCancel: () => void }) {
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
    <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">{item.name}</h3>
      <p className="mb-3 text-sm text-neutral-500">Base {money(item.price)}</p>

      {item.modifier_groups.map((g) => (
        <div key={g.id} className="mb-3">
          <div className="mb-1 text-xs text-neutral-500">{g.label} {g.type === "single" ? "(choose 1)" : "(optional)"}</div>
          <div className="flex flex-wrap gap-1.5">
            {g.options.map((o) => {
              const picked = (sel[g.key] ?? []).includes(o.name);
              return (
                <button
                  key={o.id}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    picked
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-300 dark:border-neutral-700"
                  }`}
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button className="h-7 w-7 rounded border border-neutral-300 dark:border-neutral-700" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
            −
          </button>
          <span className="min-w-[1.5rem] text-center font-medium">{qty}</span>
          <button className="h-7 w-7 rounded border border-neutral-300 dark:border-neutral-700" onClick={() => setQty((q) => q + 1)}>
            +
          </button>
        </div>
        <div className="text-lg font-semibold">{money(unitPrice() * qty)}</div>
        <div className="flex gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            onClick={handleAdd}
          >
            Add to order
          </button>
        </div>
      </div>
    </div>
  );
}
