"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth";
import type { IngredientUnit } from "@/lib/types";

function revalidate() {
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/reports");
}

export async function addIngredient(fields: { name: string; unit: IngredientUnit; bottleSize?: number | null; category?: string }) {
  const name = fields.name.trim();
  if (!name) return;
  const supabase = createAdminClient();
  await supabase.from("ingredients").insert({
    name,
    unit: fields.unit,
    bottle_size: fields.bottleSize ?? null,
    category: fields.category?.trim() || null,
  });
  revalidate();
}

export async function updateIngredient(
  id: string,
  fields: Partial<{ name: string; unit: IngredientUnit; bottle_size: number | null; category: string | null }>
) {
  const supabase = createAdminClient();
  await supabase.from("ingredients").update(fields).eq("id", id);
  revalidate();
}

export async function setIngredientActive(id: string, active: boolean) {
  const supabase = createAdminClient();
  await supabase.from("ingredients").update({ active }).eq("id", id);
  revalidate();
}

// Staff log what's physically on the shelf periodically -- these snapshots
// are what the Reports "alcohol usage & variance" section compares against
// recipe-based theoretical usage to surface overpour/waste.
export async function addInventoryCount(ingredientId: string, quantityOnHand: number, note?: string) {
  if (!(quantityOnHand >= 0)) return;
  const staff = await requireStaff();
  const supabase = createAdminClient();
  await supabase.from("inventory_counts").insert({
    ingredient_id: ingredientId,
    quantity_on_hand: quantityOnHand,
    counted_by: staff.employeeId,
    note: note?.trim() || null,
  });
  revalidate();
}
