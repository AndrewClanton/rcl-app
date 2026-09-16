import { createAdminClient } from "@/lib/supabase/admin";
import type { Ingredient } from "@/lib/types";

// Ingredients have no public-read RLS policy -- staff-only catalog, always
// read via the service-role client (same posture as members.ts).
export async function getIngredients(): Promise<Ingredient[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("ingredients").select("*").order("category").order("name");
  if (error) throw error;
  return data ?? [];
}

export interface IngredientWithLastCount extends Ingredient {
  lastCount: { quantity_on_hand: number; counted_at: string } | null;
}

// Ingredients plus their most recent physical count, for the inventory
// admin page -- lets staff see "what do we think is on the shelf right now"
// at a glance without opening each ingredient's full count history.
export async function getIngredientsWithLastCount(): Promise<IngredientWithLastCount[]> {
  const supabase = createAdminClient();
  const [{ data: ingredients, error: ingErr }, { data: counts, error: countErr }] = await Promise.all([
    supabase.from("ingredients").select("*").order("category").order("name"),
    supabase.from("inventory_counts").select("ingredient_id, quantity_on_hand, counted_at").order("counted_at", { ascending: false }),
  ]);
  if (ingErr) throw ingErr;
  if (countErr) throw countErr;

  const lastByIngredient = new Map<string, { quantity_on_hand: number; counted_at: string }>();
  for (const c of counts ?? []) {
    if (!lastByIngredient.has(c.ingredient_id)) {
      lastByIngredient.set(c.ingredient_id, { quantity_on_hand: Number(c.quantity_on_hand), counted_at: c.counted_at });
    }
  }

  return (ingredients ?? []).map((i) => ({ ...i, lastCount: lastByIngredient.get(i.id) ?? null }));
}
