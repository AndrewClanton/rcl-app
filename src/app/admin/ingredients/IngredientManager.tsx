"use client";

import { useMemo, useState } from "react";
import type { IngredientUnit } from "@/lib/types";
import type { IngredientWithLastCount } from "@/lib/data/ingredients";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addIngredient, addInventoryCount, setIngredientActive, updateIngredient } from "./actions";

function unitLabel(unit: IngredientUnit) {
  return unit === "count" ? "ct" : unit;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function IngredientManager({ ingredients }: { ingredients: IngredientWithLastCount[] }) {
  const [showInactive, setShowInactive] = useState(false);

  const grouped = useMemo(() => {
    const visible = ingredients.filter((i) => i.active || showInactive);
    const byCategory = new Map<string, IngredientWithLastCount[]>();
    for (const i of visible) {
      const key = i.category || "Uncategorized";
      const list = byCategory.get(key) ?? [];
      list.push(i);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ingredients, showInactive]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated ingredients
        </label>
      </div>

      {grouped.map(([category, items]) => (
        <div key={category} className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{category}</h2>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {items.map((ing) => (
              <IngredientRow key={ing.id} ingredient={ing} />
            ))}
          </div>
        </div>
      ))}

      {grouped.length === 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950">
          No ingredients yet -- add one below, then attach it to a recipe from Menu → an alcohol item → Recipe.
        </div>
      )}

      <AddIngredientForm />
    </div>
  );
}

function IngredientRow({ ingredient }: { ingredient: IngredientWithLastCount }) {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState(ingredient.name);
  const [countOpen, setCountOpen] = useState(false);

  // Staff know what a bottle costs, not the per-ounce math -- when a
  // bottle size is on file, cost is always entered as $/bottle and this
  // computes $/unit for the recipe/report math. Only ingredients with no
  // bottle size (fresh juice, garnishes, fountain soda) fall back to a
  // direct per-unit cost, since there's no bottle to divide by.
  const hasBottleSize = ingredient.bottle_size != null && ingredient.bottle_size > 0;
  const [bottleCost, setBottleCost] = useState(
    hasBottleSize && ingredient.unit_cost != null ? (ingredient.unit_cost * ingredient.bottle_size!).toFixed(2) : ""
  );
  const [directUnitCost, setDirectUnitCost] = useState(!hasBottleSize && ingredient.unit_cost != null ? String(ingredient.unit_cost) : "");

  function saveBottleCost() {
    const v = bottleCost.trim() === "" ? null : parseFloat(bottleCost);
    if (v !== null && isNaN(v)) return;
    const newUnitCost = v === null ? null : v / ingredient.bottle_size!;
    if (newUnitCost !== ingredient.unit_cost) run(() => updateIngredient(ingredient.id, { unit_cost: newUnitCost }));
  }

  function saveDirectUnitCost() {
    const v = directUnitCost.trim() === "" ? null : parseFloat(directUnitCost);
    if (v !== null && isNaN(v)) return;
    if (v !== ingredient.unit_cost) run(() => updateIngredient(ingredient.id, { unit_cost: v }));
  }

  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[140px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== ingredient.name) run(() => updateIngredient(ingredient.id, { name: name.trim() }));
          }}
        />
        <span className="text-xs text-neutral-500">
          {unitLabel(ingredient.unit)}
          {ingredient.bottle_size ? ` · ${ingredient.bottle_size} ${unitLabel(ingredient.unit)}/bottle` : ""}
        </span>
        {hasBottleSize ? (
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            <span>$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="bottle cost"
              value={bottleCost}
              onChange={(e) => setBottleCost(e.target.value)}
              onBlur={saveBottleCost}
            />
            <span>/bottle</span>
            {ingredient.unit_cost != null && (
              <span className="text-neutral-400">({money(ingredient.unit_cost)}/{unitLabel(ingredient.unit)})</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            <span>$</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="cost"
              value={directUnitCost}
              onChange={(e) => setDirectUnitCost(e.target.value)}
              onBlur={saveDirectUnitCost}
            />
            <span>/{unitLabel(ingredient.unit)}</span>
          </div>
        )}
        {!ingredient.active && (
          <span className="rounded-full border border-neutral-400 px-2 py-0.5 text-xs text-neutral-500">deactivated</span>
        )}
        <button
          className="ml-auto text-xs text-neutral-500 hover:underline"
          disabled={pending}
          onClick={() => run(() => setIngredientActive(ingredient.id, !ingredient.active))}
        >
          {ingredient.active ? "Deactivate" : "Reactivate"}
        </button>
        <button className="text-xs text-neutral-500 hover:underline" onClick={() => setCountOpen((v) => !v)}>
          Log count...
        </button>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {ingredient.lastCount
          ? `Last counted: ${ingredient.lastCount.quantity_on_hand} ${unitLabel(ingredient.unit)} on ${new Date(
              ingredient.lastCount.counted_at
            ).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "No counts logged yet."}
      </div>

      {countOpen && (
        <LogCountForm
          ingredientId={ingredient.id}
          unit={ingredient.unit}
          pending={pending}
          onSubmit={(qty, note) => {
            run(() => addInventoryCount(ingredient.id, qty, note));
            setCountOpen(false);
          }}
          onCancel={() => setCountOpen(false)}
        />
      )}
    </div>
  );
}

function LogCountForm({
  unit,
  pending,
  onSubmit,
  onCancel,
}: {
  ingredientId: string;
  unit: IngredientUnit;
  pending: boolean;
  onSubmit: (quantity: number, note: string) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Quantity on hand ({unitLabel(unit)})</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs text-neutral-500">Note (optional)</label>
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. end of Friday shift"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !(parseFloat(qty) >= 0)}
          onClick={() => onSubmit(parseFloat(qty), note)}
        >
          Log count
        </button>
        <button className="text-xs text-neutral-500 hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddIngredientForm() {
  const [pending, run] = useRefreshingAction();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<IngredientUnit>("oz");
  const [bottleSize, setBottleSize] = useState("");
  const [bottleCost, setBottleCost] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [category, setCategory] = useState("");

  const bottleSizeNum = parseFloat(bottleSize);
  const bottleCostNum = parseFloat(bottleCost);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-3 text-lg font-semibold">Add ingredient</h2>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Name</label>
          <input
            className="min-w-[160px] rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. Well Vodka"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Category</label>
          <input
            className="min-w-[140px] rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. Spirit, Mixer, Garnish"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Unit</label>
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={unit}
            onChange={(e) => setUnit(e.target.value as IngredientUnit)}
          >
            <option value="oz">oz</option>
            <option value="ml">ml</option>
            <option value="count">count (e.g. limes)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Bottle size (optional)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. 25.4"
            value={bottleSize}
            onChange={(e) => setBottleSize(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Cost per bottle (optional)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. 18.00"
            value={bottleCost}
            onChange={(e) => setBottleCost(e.target.value)}
            disabled={!bottleSize}
            title={bottleSize ? undefined : "Set a bottle size first"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">
            {bottleSize && bottleCostNum > 0 && bottleSizeNum > 0 ? `Cost/${unitLabel(unit)} (auto)` : `Cost per ${unitLabel(unit)} (optional)`}
          </label>
          <input
            type="number"
            step="0.0001"
            min="0"
            className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={bottleSize && bottleCostNum > 0 && bottleSizeNum > 0 ? (bottleCostNum / bottleSizeNum).toFixed(4) : unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            disabled={!!(bottleSize && bottleCostNum > 0 && bottleSizeNum > 0)}
          />
        </div>
        <button
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !name.trim()}
          onClick={() => {
            const computedUnitCost =
              bottleSize && bottleCostNum > 0 && bottleSizeNum > 0 ? bottleCostNum / bottleSizeNum : unitCost ? parseFloat(unitCost) : null;
            const fields = { name, unit, bottleSize: bottleSize ? bottleSizeNum : null, unitCost: computedUnitCost, category };
            setName("");
            setBottleSize("");
            setBottleCost("");
            setUnitCost("");
            setCategory("");
            run(() => addIngredient(fields));
          }}
        >
          Add ingredient
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {bottleSize && bottleCostNum > 0 && bottleSizeNum > 0
          ? `${money(bottleCostNum)} ÷ ${bottleSizeNum} ${unitLabel(unit)} = ${money(bottleCostNum / bottleSizeNum)}/${unitLabel(unit)} -- used for the $ pour-cost report.`
          : "Cost is optional but powers the $ variance and pour-cost reports on the Reports page."}
      </p>
    </div>
  );
}
