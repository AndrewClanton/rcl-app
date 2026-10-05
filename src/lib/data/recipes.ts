import { createAdminClient } from "@/lib/supabase/admin";
import { schemaMissing } from "@/lib/schema-missing";
import type { Recipe } from "@/lib/types";

interface RecipeRow {
  id: string;
  menu_item_id: string | null;
  instructions: string | null;
  glassware: string | null;
  garnish: string | null;
  cost_complete?: boolean | null; // missing before the owner tab migration
  method?: string | null;
  garnishes?: string[] | null;
  ice?: string | null;
  description?: string | null;
  ingredients: {
    id: string;
    ingredient_id: string;
    quantity: number;
    sort_order: number;
    optional?: boolean | null;
    ingredient: { name: string; unit: string; family?: string | null; kind?: string | null } | null;
  }[];
}

// "*": cost_complete (owner tab migration) and the Bar Book columns only exist once their migrations are in.
const BASE = "*";
const LINES = "id, ingredient_id, quantity, sort_order";
// What the drink icons and recipe cards read (each ingredient's color
// family, the method, garnishes, ice) once the Bar Book migration
// (20261004010000) is in; the plain columns before it.
const WITH_BAR_BOOK = `${BASE}, ingredients:recipe_ingredients(${LINES}, optional, ingredient:ingredients(name, unit, family, kind))`;
const PLAIN = `${BASE}, ingredients:recipe_ingredients(${LINES}, ingredient:ingredients(name, unit))`;

// Recipes are staff-only (no public-read policy) and fetched separately
// from the public menu tree -- never joined onto MenuItem, which the
// customer-facing /menu page also renders from the same query. Used by the
// POS (recipe display, drink icons) and the admin menu editor. Only menu
// items' recipes: a Bar Book drink with no menu item isn't one.
export async function getRecipesByItem(): Promise<Record<string, Recipe>> {
  const supabase = createAdminClient();
  const read = (columns: string) => supabase.from("recipes").select(columns).order("sort_order", { referencedTable: "recipe_ingredients" });
  let { data, error } = await read(WITH_BAR_BOOK);
  if (error && schemaMissing(error)) ({ data, error } = await read(PLAIN));
  if (error) throw error;

  const map: Record<string, Recipe> = {};
  for (const r of (data ?? []) as unknown as RecipeRow[]) {
    if (!r.menu_item_id) continue;
    map[r.menu_item_id] = {
      id: r.id,
      menu_item_id: r.menu_item_id,
      instructions: r.instructions,
      glassware: r.glassware,
      garnish: r.garnish,
      cost_complete: r.cost_complete === true,
      ...(r.method !== undefined ? { method: r.method, garnishes: r.garnishes ?? [], ice: r.ice ?? null, description: r.description ?? null } : {}),
      ingredients: r.ingredients
        .filter((ri) => ri.ingredient)
        .map((ri) => ({
          id: ri.id,
          ingredient_id: ri.ingredient_id,
          ingredient_name: ri.ingredient!.name,
          unit: ri.ingredient!.unit as Recipe["ingredients"][number]["unit"],
          quantity: Number(ri.quantity),
          sort_order: ri.sort_order,
          ...(ri.ingredient!.family !== undefined ? { family: ri.ingredient!.family, kind: ri.ingredient!.kind ?? null, optional: ri.optional === true } : {}),
        })),
    };
  }
  return map;
}
