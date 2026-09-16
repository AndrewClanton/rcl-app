"use client";

import { useState } from "react";
import type { Ingredient, MenuItem, Recipe } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addRecipeIngredient, removeRecipeIngredient, updateRecipeIngredientQuantity, updateRecipeMeta } from "./actions";

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

export default function ItemRecipe({ item, recipe, ingredients }: { item: MenuItem; recipe: Recipe | null; ingredients: Ingredient[] }) {
  const [, run] = useRefreshingAction();
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [glassware, setGlassware] = useState(recipe?.glassware ?? "");
  const [garnish, setGarnish] = useState(recipe?.garnish ?? "");

  const activeIngredients = ingredients.filter((i) => i.active);
  const usedIds = new Set((recipe?.ingredients ?? []).map((ri) => ri.ingredient_id));
  const available = activeIngredients.filter((i) => !usedIds.has(i.id));

  return (
    <div className="mt-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/10">
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Glassware</label>
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. Rocks glass"
            value={glassware}
            onChange={(e) => setGlassware(e.target.value)}
            onBlur={() => {
              if (glassware !== (recipe?.glassware ?? "")) run(() => updateRecipeMeta(item.id, { glassware: glassware.trim() || null }));
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Garnish</label>
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="e.g. Orange twist"
            value={garnish}
            onChange={(e) => setGarnish(e.target.value)}
            onBlur={() => {
              if (garnish !== (recipe?.garnish ?? "")) run(() => updateRecipeMeta(item.id, { garnish: garnish.trim() || null }));
            }}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs text-neutral-500">Method / instructions</label>
        <textarea
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          rows={2}
          placeholder="e.g. Shake with ice, strain into glass."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => {
            if (instructions !== (recipe?.instructions ?? "")) run(() => updateRecipeMeta(item.id, { instructions: instructions.trim() || null }));
          }}
        />
      </div>

      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Ingredients</div>
      {(recipe?.ingredients ?? []).length === 0 ? (
        <div className="mb-2 text-sm text-neutral-500">No ingredients yet.</div>
      ) : (
        <div className="mb-2 space-y-1">
          {(recipe?.ingredients ?? []).map((ri) => (
            <RecipeIngredientRow key={ri.id} id={ri.id} name={ri.ingredient_name} unit={ri.unit} quantity={ri.quantity} />
          ))}
        </div>
      )}

      <AddRecipeIngredientRow menuItemId={item.id} available={available} />

      {ingredients.length === 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          No ingredients in the catalog yet -- add some from the Ingredients admin page first.
        </p>
      )}
    </div>
  );
}

function RecipeIngredientRow({ id, name, unit, quantity }: { id: string; name: string; unit: string; quantity: number }) {
  const [pending, run] = useRefreshingAction();
  const [value, setValue] = useState(String(quantity));

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="min-w-[140px] flex-1">{name}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const v = parseFloat(value);
          if (!isNaN(v) && v > 0 && v !== quantity) run(() => updateRecipeIngredientQuantity(id, v));
        }}
      />
      <span className="w-8 text-xs text-neutral-500">{unitLabel(unit)}</span>
      <button className="text-xs text-red-600 hover:underline" disabled={pending} onClick={() => run(() => removeRecipeIngredient(id))}>
        Remove
      </button>
    </div>
  );
}

function AddRecipeIngredientRow({ menuItemId, available }: { menuItemId: string; available: Ingredient[] }) {
  const [pending, run] = useRefreshingAction();
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const selected = available.find((i) => i.id === ingredientId);

  if (available.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[140px]">
        <label className="mb-1 block text-xs text-neutral-500">Ingredient</label>
        <select
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
        >
          <option value="">Select...</option>
          {available.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Quantity{selected ? ` (${unitLabel(selected.unit)})` : ""}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>
      <button
        className="rounded border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700"
        disabled={pending || !ingredientId || !(parseFloat(quantity) > 0)}
        onClick={() => {
          const qty = parseFloat(quantity);
          const id = ingredientId;
          setIngredientId("");
          setQuantity("");
          run(() => addRecipeIngredient(menuItemId, id, qty));
        }}
      >
        Add ingredient
      </button>
    </div>
  );
}
