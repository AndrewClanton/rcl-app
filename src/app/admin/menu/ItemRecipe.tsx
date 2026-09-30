"use client";

import { useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import type { Ingredient, MenuItem, ParItemRef, Recipe } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { removeRecipeIngredient, updateRecipeIngredientQuantity, updateRecipeMeta } from "./actions";
import IngredientPicker from "./IngredientPicker";

function unitLabel(unit: string) {
  return unit === "count" ? "ct" : unit;
}

// Cashiers (bartenders) see the recipe as plain text; managers edit it.
function ReadOnlyRecipe({ recipe }: { recipe: Recipe | null }) {
  const ingredients = recipe?.ingredients ?? [];
  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--warn-border)] bg-[var(--warn-bg)] p-3 text-sm">
      {!recipe || (!recipe.glassware && !recipe.garnish && !recipe.instructions && ingredients.length === 0) ? (
        <p className="text-[var(--muted)]">No recipe written down yet.</p>
      ) : (
        <>
          {recipe.glassware && (
            <p>
              <span className="text-xs text-[var(--muted)]">Glassware:</span> {recipe.glassware}
            </p>
          )}
          {recipe.garnish && (
            <p>
              <span className="text-xs text-[var(--muted)]">Garnish:</span> {recipe.garnish}
            </p>
          )}
          {ingredients.length > 0 && (
            <ul className="my-1.5 list-disc pl-5">
              {ingredients.map((ri) => (
                <li key={ri.id}>
                  {ri.quantity} {unitLabel(ri.unit)} {ri.ingredient_name}
                </li>
              ))}
            </ul>
          )}
          {recipe.instructions && <p className="whitespace-pre-line">{recipe.instructions}</p>}
        </>
      )}
    </div>
  );
}

export default function ItemRecipe({
  item,
  recipe,
  ingredients,
  parItems,
  canEdit,
}: {
  item: MenuItem;
  recipe: Recipe | null;
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  canEdit: boolean;
}) {
  if (!canEdit) return <ReadOnlyRecipe recipe={recipe} />;
  return <RecipeEditor item={item} recipe={recipe} ingredients={ingredients} parItems={parItems} />;
}

function RecipeEditor({ item, recipe, ingredients, parItems }: { item: MenuItem; recipe: Recipe | null; ingredients: Ingredient[]; parItems: ParItemRef[] }) {
  const [, run] = useRefreshingAction();
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [glassware, setGlassware] = useState(recipe?.glassware ?? "");
  const [garnish, setGarnish] = useState(recipe?.garnish ?? "");

  const usedIds = (recipe?.ingredients ?? []).map((ri) => ri.ingredient_id);

  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--warn-border)] bg-[var(--warn-bg)] p-3 ">
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Glassware</label>
          <input
            className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
            placeholder="e.g. Rocks glass"
            value={glassware}
            onChange={(e) => setGlassware(e.target.value)}
            onBlur={() => {
              if (glassware !== (recipe?.glassware ?? "")) run(() => updateRecipeMeta(item.id, { glassware: glassware.trim() || null }));
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Garnish</label>
          <input
            className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
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
        <label className="mb-1 block text-xs text-[var(--muted)]">Method / instructions</label>
        <textarea
          className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
          rows={2}
          placeholder="e.g. Shake with ice, strain into glass."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => {
            if (instructions !== (recipe?.instructions ?? "")) run(() => updateRecipeMeta(item.id, { instructions: instructions.trim() || null }));
          }}
        />
      </div>

      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        Ingredients
        <InfoTip topic="recipes-par-link" />
      </div>
      {(recipe?.ingredients ?? []).length === 0 ? (
        <div className="mb-2 text-sm text-[var(--muted)]">No ingredients yet.</div>
      ) : (
        <div className="mb-2 space-y-1">
          {(recipe?.ingredients ?? []).map((ri) => (
            <RecipeIngredientRow key={ri.id} id={ri.id} name={ri.ingredient_name} unit={ri.unit} quantity={ri.quantity} />
          ))}
        </div>
      )}

      <IngredientPicker menuItemId={item.id} ingredients={ingredients} parItems={parItems} usedIngredientIds={usedIds} />
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
        className="w-20 rounded border border-[var(--border)] px-2 py-1 text-sm "
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const v = parseFloat(value);
          if (!isNaN(v) && v > 0 && v !== quantity) run(() => updateRecipeIngredientQuantity(id, v));
        }}
      />
      <span className="w-8 text-xs text-[var(--muted)]">{unitLabel(unit)}</span>
      <button className="text-xs text-[var(--danger-text)] hover:underline" disabled={pending} onClick={() => run(() => removeRecipeIngredient(id))}>
        Remove
      </button>
    </div>
  );
}
