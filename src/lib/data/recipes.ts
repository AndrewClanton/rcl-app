import { createAdminClient } from "@/lib/supabase/admin";
import type { Recipe } from "@/lib/types";

interface RecipeRow {
  id: string;
  menu_item_id: string;
  instructions: string | null;
  glassware: string | null;
  garnish: string | null;
  ingredients: {
    id: string;
    ingredient_id: string;
    quantity: number;
    sort_order: number;
    ingredient: { name: string; unit: string } | null;
  }[];
}

// Recipes are staff-only (no public-read policy) and fetched separately
// from the public menu tree -- never joined onto MenuItem, which the
// customer-facing /menu page also renders from the same query. Used by the
// POS (recipe display) and the admin menu editor.
export async function getRecipesByItem(): Promise<Record<string, Recipe>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("recipes")
    .select(
      "id, menu_item_id, instructions, glassware, garnish, ingredients:recipe_ingredients(id, ingredient_id, quantity, sort_order, ingredient:ingredients(name, unit))"
    )
    .order("sort_order", { referencedTable: "recipe_ingredients" });
  if (error) throw error;

  const map: Record<string, Recipe> = {};
  for (const r of (data ?? []) as unknown as RecipeRow[]) {
    map[r.menu_item_id] = {
      id: r.id,
      menu_item_id: r.menu_item_id,
      instructions: r.instructions,
      glassware: r.glassware,
      garnish: r.garnish,
      ingredients: r.ingredients
        .filter((ri) => ri.ingredient)
        .map((ri) => ({
          id: ri.id,
          ingredient_id: ri.ingredient_id,
          ingredient_name: ri.ingredient!.name,
          unit: ri.ingredient!.unit as Recipe["ingredients"][number]["unit"],
          quantity: Number(ri.quantity),
          sort_order: ri.sort_order,
        })),
    };
  }
  return map;
}
