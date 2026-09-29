"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff, assertStaff, getStaffSession, hasManagerAccess } from "@/lib/auth";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which par sheet line an ingredient is bought as (or none). Managers and up,
// like the rest of the par sheet and the recipes. One ingredient per line,
// so the recipe editor knows which lines are already covered.
export async function linkIngredientToPar(ingredientId: string, parItemId: string | null): Promise<Result> {
  const staff = await getStaffSession();
  if (!staff) return { ok: false, error: "Your staff session has expired. Sign in again." };
  if (!hasManagerAccess(staff.role)) return { ok: false, error: "Only a manager can change where an ingredient is on the par sheet." };
  if (typeof ingredientId !== "string" || !UUID.test(ingredientId)) return { ok: false, error: "That ingredient isn't there anymore. Refresh the page." };
  if (parItemId !== null && (typeof parItemId !== "string" || !UUID.test(parItemId))) return { ok: false, error: "Pick a line from the par sheet list." };

  const supabase = createAdminClient();
  if (parItemId) {
    const [{ data: par }, { data: other }] = await Promise.all([
      supabase.from("par_items").select("id, active").eq("id", parItemId).maybeSingle(),
      supabase.from("ingredients").select("id, name").eq("par_item_id", parItemId).neq("id", ingredientId).limit(1),
    ]);
    if (!par || !par.active) return { ok: false, error: "That isn't on the par sheet anymore. Refresh the page and try again." };
    if (other && other.length > 0) return { ok: false, error: `That par sheet line is already linked to "${other[0].name}". Unlink it there first.` };
  }
  const { data, error } = await supabase.from("ingredients").update({ par_item_id: parItemId }).eq("id", ingredientId).select("id");
  if (error) return { ok: false, error: "Couldn't save that change. Try again." };
  if (!data || data.length === 0) return { ok: false, error: "That ingredient isn't there anymore. Refresh the page." };
  revalidate();
  revalidatePath("/admin/menu");
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
