"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff, assertStaff } from "@/lib/auth";
import type { IngredientUnit } from "@/lib/types";

// Each returns { ok: false, error } when the database didn't take the
// change, so the screen can say so (it used to look saved either way).
type Result = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/ingredients");
  revalidatePath("/admin/reports");
}

export async function addIngredient(fields: {
  name: string;
  unit: IngredientUnit;
  bottleSize?: number | null;
  unitCost?: number | null;
  category?: string;
}): Promise<Result> {
  await assertStaff();
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Give the ingredient a name." };
  const supabase = createAdminClient();
  const { error } = await supabase.from("ingredients").insert({
    name,
    unit: fields.unit,
    bottle_size: fields.bottleSize ?? null,
    unit_cost: fields.unitCost ?? null,
    category: fields.category?.trim() || null,
  });
  if (error) return { ok: false, error: "Couldn't add that ingredient. Try again." };
  revalidate();
  return { ok: true };
}

export async function updateIngredient(
  id: string,
  fields: Partial<{ name: string; unit: IngredientUnit; bottle_size: number | null; unit_cost: number | null; category: string | null }>
): Promise<Result> {
  await assertStaff();
  const { error } = await createAdminClient().from("ingredients").update(fields).eq("id", id);
  if (error) return { ok: false, error: "Couldn't save that change. Try again." };
  revalidate();
  return { ok: true };
}

export async function setIngredientActive(id: string, active: boolean): Promise<Result> {
  await assertStaff();
  const { error } = await createAdminClient().from("ingredients").update({ active }).eq("id", id);
  if (error) return { ok: false, error: `Couldn't ${active ? "reactivate" : "deactivate"} that ingredient. Try again.` };
  revalidate();
  return { ok: true };
}

// Staff log what's physically on the shelf periodically -- these snapshots
// are what the Reports "alcohol usage & variance" section compares against
// recipe-based theoretical usage to surface overpour/waste.
export async function addInventoryCount(ingredientId: string, quantityOnHand: number, note?: string): Promise<Result> {
  if (!(quantityOnHand >= 0)) return { ok: false, error: "Enter how much is on the shelf (0 or more)." };
  const staff = await requireStaff();
  const { error } = await createAdminClient().from("inventory_counts").insert({
    ingredient_id: ingredientId,
    quantity_on_hand: quantityOnHand,
    counted_by: staff.employeeId,
    note: note?.trim() || null,
  });
  if (error) return { ok: false, error: "Couldn't save that count. Try again." };
  revalidate();
  return { ok: true };
}
