"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slugify";
import type { ModifierType, EventPriceMode } from "@/lib/types";
import { getStaffSession, hasManagerAccess } from "@/lib/auth";

// All writes here use the service-role client and bypass RLS. Menu tables
// are public-read (see the initial migration); write access is gated by
// the check at the top of every action below.
//
// Changing the menu is for managers and up (code review B5): a price or a
// deleted item changes what the register charges. Cashiers can open the
// Menu page to look things up, but every change goes through here, so the
// check lives here and not only in the page.
//
// Every action returns { ok: false, error } when it didn't save, instead of
// throwing (production hides a thrown message) or ignoring the database's
// answer (which is how a failed delete used to look like it worked).

export type Result = { ok: true } | { ok: false; error: string };

// A delete that can't happen because the item has sales, with Hide offered instead.
export type DeleteItemResult = Result | { ok: false; error: string; canHide: true };

async function denied(): Promise<Result | null> {
  const staff = await getStaffSession();
  if (!staff) return { ok: false, error: "Your staff session has expired. Sign in again." };
  if (!hasManagerAccess(staff.role)) return { ok: false, error: "Only a manager can change the menu. Ask a manager to make this change." };
  return null;
}

function failed(error: PostgrestError | null, what: string): Result | null {
  if (!error) return null;
  console.error(`menu: ${what} failed`, error);
  return { ok: false, error: `Couldn't ${what}. Try again.` };
}

function revalidate() {
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/pos");
}

// ---------- categories ----------

export async function addCategory(label: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const name = label.trim();
  if (!name) return { ok: false, error: "Give the category a name." };
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_categories").select("id", { count: "exact", head: true }).is("parent_id", null);
  const { error } = await supabase.from("menu_categories").insert({ key: slugify(name), label: name, sort_order: count ?? 0 });
  // The key is unique, and it's made from the name.
  if (error?.code === "23505") return { ok: false, error: `There's already a category called "${name}" (or one very like it). Pick another name.` };
  const f = failed(error, "add that category");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function addSubcategory(parentId: string, label: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const name = label.trim();
  if (!name) return { ok: false, error: "Give the subcategory a name." };
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("parent_id", parentId);
  const { error } = await supabase.from("menu_categories").insert({ key: slugify(name), label: name, parent_id: parentId, sort_order: count ?? 0 });
  if (error?.code === "23505") return { ok: false, error: `There's already a category called "${name}" (or one very like it). Pick another name.` };
  const f = failed(error, "add that subcategory");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function renameCategory(id: string, label: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const name = label.trim();
  if (!name) return { ok: false, error: "A category needs a name." };
  const { error } = await createAdminClient().from("menu_categories").update({ label: name }).eq("id", id);
  const f = failed(error, "rename that category");
  if (f) return f;
  revalidate();
  return { ok: true };
}

// Item ids in a category and its subcategories that have been rung up
// (or are on an open tab). Those can't be deleted: their sales point at them.
async function soldItemIds(supabase: ReturnType<typeof createAdminClient>, itemIds: string[]): Promise<Set<string> | null> {
  if (itemIds.length === 0) return new Set();
  const { data, error } = await supabase.from("order_items").select("menu_item_id").in("menu_item_id", itemIds).limit(1000);
  if (error) return null;
  return new Set((data ?? []).map((r) => r.menu_item_id as string));
}

export async function deleteCategory(id: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const supabase = createAdminClient();
  const { data: subs } = await supabase.from("menu_categories").select("id").eq("parent_id", id);
  const categoryIds = [id, ...(subs ?? []).map((s) => s.id as string)];
  const { data: items } = await supabase.from("menu_items").select("id, name").in("category_id", categoryIds);
  const sold = await soldItemIds(
    supabase,
    (items ?? []).map((i) => i.id as string),
  );
  if (sold && sold.size > 0) {
    const names = (items ?? []).filter((i) => sold.has(i.id as string)).map((i) => i.name as string);
    const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
    return {
      ok: false,
      error: `Can't delete this category: ${list} ${names.length === 1 ? "has" : "have"} been sold, and past sales point at ${names.length === 1 ? "it" : "them"}. Hide those items from the register instead (open the category, then "Hide from register").`,
    };
  }
  // ON DELETE CASCADE handles subcategories, items, modifier groups/options.
  const { error } = await supabase.from("menu_categories").delete().eq("id", id);
  if (error?.code === "23503") return { ok: false, error: "Can't delete this category: something in it has been sold. Hide those items from the register instead." };
  const f = failed(error, "delete that category");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function reorderCategory(id: string, direction: "up" | "down", siblingIds: string[]): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const idx = siblingIds.indexOf(id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapWith < 0 || swapWith >= siblingIds.length) return { ok: true };

  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("menu_categories")
    .select("id, sort_order")
    .in("id", [siblingIds[idx], siblingIds[swapWith]]);
  if (!rows || rows.length !== 2) return { ok: false, error: "The menu changed while you were looking at it. Try again." };

  const [a, b] = rows;
  const results = await Promise.all([
    supabase.from("menu_categories").update({ sort_order: b.sort_order }).eq("id", a.id),
    supabase.from("menu_categories").update({ sort_order: a.sort_order }).eq("id", b.id),
  ]);
  const f = failed(results.find((r) => r.error)?.error ?? null, "move that category");
  if (f) return f;
  revalidate();
  return { ok: true };
}

// ---------- items ----------

export async function addItem(categoryId: string, name: string, price: number, isAlcohol = false): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the item a name." };
  if (!(price >= 0)) return { ok: false, error: "Enter a price of $0.00 or more." };
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("category_id", categoryId);
  const { error } = await supabase.from("menu_items").insert({ category_id: categoryId, name: trimmed, price, is_alcohol: isAlcohol, sort_order: count ?? 0 });
  const f = failed(error, "add that item");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function updateItem(
  id: string,
  fields: Partial<{ name: string; price: number; is_alcohol: boolean; is_event_item: boolean; event_price_mode: EventPriceMode | null; active: boolean }>,
): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (fields.name !== undefined && !fields.name.trim()) return { ok: false, error: "An item needs a name." };
  if (fields.price !== undefined && !(fields.price >= 0)) return { ok: false, error: "Enter a price of $0.00 or more." };
  const { error } = await createAdminClient().from("menu_items").update(fields).eq("id", id);
  const f = failed(error, "save that change");
  if (f) return f;
  revalidate();
  return { ok: true };
}

// Hidden items stay in the menu (and in every past sale) but come off the
// register. menu_items.active has been in the schema since the start; this
// is the first screen that sets it.
export async function setItemHidden(id: string, hidden: boolean): Promise<Result> {
  return updateItem(id, { active: !hidden });
}

// An item that has ever been rung up can't be deleted: order_items.menu_item_id
// points at it, and the database refuses (which used to fail silently). The
// answer offers Hide instead, which keeps the history and takes it off the
// register.
export async function deleteItem(id: string): Promise<DeleteItemResult> {
  const no = await denied();
  if (no) return no;
  const supabase = createAdminClient();
  const cantDelete = { ok: false as const, canHide: true as const, error: "This item has been sold before (or is on an open tab), so it can't be deleted: past sales point at it. Hide it from the register instead." };
  const sold = await soldItemIds(supabase, [id]);
  if (sold?.has(id)) return cantDelete;
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  if (error?.code === "23503") return cantDelete;
  const f = failed(error, "delete that item");
  if (f) return f;
  revalidate();
  return { ok: true };
}

// ---------- modifier groups & options ----------

export async function addModifierGroup(itemId: string, label: string, type: ModifierType): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const name = label.trim();
  if (!name) return { ok: false, error: "Give the group a label, like Size." };
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_modifier_groups").select("id", { count: "exact", head: true }).eq("item_id", itemId);
  const { error } = await supabase.from("menu_modifier_groups").insert({ item_id: itemId, key: slugify(name), label: name, type, sort_order: count ?? 0 });
  const f = failed(error, "add that group");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function deleteModifierGroup(id: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const { error } = await createAdminClient().from("menu_modifier_groups").delete().eq("id", id);
  const f = failed(error, "delete that group");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function addModifierOption(groupId: string, name: string, priceDelta: number): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the option a name." };
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_modifier_options").select("id", { count: "exact", head: true }).eq("group_id", groupId);
  const { error } = await supabase.from("menu_modifier_options").insert({ group_id: groupId, name: trimmed, price_delta: priceDelta || 0, sort_order: count ?? 0 });
  const f = failed(error, "add that option");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function updateModifierOption(id: string, fields: Partial<{ name: string; price_delta: number }>): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const { error } = await createAdminClient().from("menu_modifier_options").update(fields).eq("id", id);
  const f = failed(error, "save that option");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function deleteModifierOption(id: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const { error } = await createAdminClient().from("menu_modifier_options").delete().eq("id", id);
  const f = failed(error, "remove that option");
  if (f) return f;
  revalidate();
  return { ok: true };
}

// ---------- recipes ----------
// One recipes row per menu item (unique on menu_item_id) holds the
// free-text how-to; recipe_ingredients holds the measured ingredient list.
// Every mutation upserts the recipe row first so the UI never has to create
// one explicitly before adding its first ingredient.

async function ensureRecipeId(supabase: ReturnType<typeof createAdminClient>, menuItemId: string): Promise<string | null> {
  const { data: existing } = await supabase.from("recipes").select("id").eq("menu_item_id", menuItemId).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase.from("recipes").insert({ menu_item_id: menuItemId }).select("id").single();
  if (error) {
    console.error("menu: recipe not created", error);
    return null;
  }
  return created.id;
}

export async function updateRecipeMeta(menuItemId: string, fields: Partial<{ instructions: string | null; glassware: string | null; garnish: string | null }>): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const supabase = createAdminClient();
  const recipeId = await ensureRecipeId(supabase, menuItemId);
  if (!recipeId) return { ok: false, error: "Couldn't save the recipe. Try again." };
  const { error } = await supabase.from("recipes").update(fields).eq("id", recipeId);
  const f = failed(error, "save the recipe");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function addRecipeIngredient(menuItemId: string, ingredientId: string, quantity: number): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!(quantity > 0)) return { ok: false, error: "Enter how much goes in (more than 0)." };
  const supabase = createAdminClient();
  const recipeId = await ensureRecipeId(supabase, menuItemId);
  if (!recipeId) return { ok: false, error: "Couldn't save the recipe. Try again." };
  const { count } = await supabase.from("recipe_ingredients").select("id", { count: "exact", head: true }).eq("recipe_id", recipeId);
  const { error } = await supabase
    .from("recipe_ingredients")
    .upsert({ recipe_id: recipeId, ingredient_id: ingredientId, quantity, sort_order: count ?? 0 }, { onConflict: "recipe_id,ingredient_id" });
  const f = failed(error, "add that ingredient");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function updateRecipeIngredientQuantity(id: string, quantity: number): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!(quantity > 0)) return { ok: false, error: "Enter how much goes in (more than 0)." };
  const { error } = await createAdminClient().from("recipe_ingredients").update({ quantity }).eq("id", id);
  const f = failed(error, "save that amount");
  if (f) return f;
  revalidate();
  return { ok: true };
}

export async function removeRecipeIngredient(id: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const { error } = await createAdminClient().from("recipe_ingredients").delete().eq("id", id);
  const f = failed(error, "remove that ingredient");
  if (f) return f;
  revalidate();
  return { ok: true };
}
