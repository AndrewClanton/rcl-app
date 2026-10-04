"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffSession, hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import { GLASS_LABEL, isFamily, isGlass, isIce, isKind, isMethod, type GlassKey, type Ice, type Method } from "@/lib/bar/icons";
import { barSectionOf, isBarCategory } from "@/lib/bar/menu";
import { TARGET_POUR_COST_SETTING, unitCostFromBottle, validTarget } from "@/lib/bar/pricing";
import { findPictureLater, insertMenuItem } from "@/lib/menu-items";

// Back office → Bar Book: managers and up set what an ingredient is (kind,
// color family, carried) and what it costs, and add or change the book's own
// drinks (no menu item). Owners and admins set the target pour cost and turn
// a book drink into a menu item (that's a new price on the register). Every
// input is checked here: the browser could send anything.

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

async function denied(): Promise<Result | null> {
  const staff = await getStaffSession();
  if (!staff) return { ok: false, error: "Your staff session has expired. Sign in again." };
  if (!hasManagerAccess(staff.role)) return { ok: false, error: "Only a manager can change the Bar Book. Ask a manager to make this change." };
  return null;
}

async function notOwner(): Promise<{ no: Result; employeeId: null } | { no: null; employeeId: string }> {
  const staff = await getStaffSession();
  if (!staff) return { no: { ok: false, error: "Your staff session has expired. Sign in again." }, employeeId: null };
  if (!hasAdminAccess(staff.role)) return { no: { ok: false, error: "Only an owner or admin can do this." }, employeeId: null };
  return { no: null, employeeId: staff.employeeId };
}

function revalidate() {
  revalidatePath("/admin/bar-book");
  revalidatePath("/admin/ingredients");
}

// What an ingredient costs: a bottle's price and size (unit_cost is the
// price ÷ the size, per oz for an oz ingredient; the size is kept too), or
// for anything counted, its cost each. Null clears it. The Bar usage
// report and the recipe cards read unit_cost.
export async function setIngredientCost(id: string, cost: { bottlePrice: number; bottleSize: number } | { unitCost: number | null }): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!isId(id)) return { ok: false, error: "That ingredient isn't there anymore. Refresh the page." };
  const patch: { unit_cost: number | null; bottle_size?: number } = { unit_cost: null };
  if (cost && "bottlePrice" in cost) {
    const price = Number(cost.bottlePrice);
    const size = Number(cost.bottleSize);
    if (!(size > 0 && size < 10000)) return { ok: false, error: "Enter the bottle's size (25.4 oz for a 750 ml bottle)." };
    if (!(price >= 0 && price < 10000)) return { ok: false, error: "Enter what a bottle costs, like 18.99." };
    patch.unit_cost = unitCostFromBottle(price, size);
    patch.bottle_size = Math.round(size * 100) / 100;
  } else if (cost && "unitCost" in cost) {
    if (cost.unitCost !== null && !(typeof cost.unitCost === "number" && Number.isFinite(cost.unitCost) && cost.unitCost >= 0 && cost.unitCost < 10000)) {
      return { ok: false, error: "Enter what one costs, like 0.25." };
    }
    patch.unit_cost = cost.unitCost === null ? null : Math.round(cost.unitCost * 10000) / 10000;
  } else {
    return { ok: false, error: "Couldn't save that cost. Try again." };
  }
  const { data, error } = await createAdminClient().from("ingredients").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: "Couldn't save that cost. Try again." };
  if (!data?.length) return { ok: false, error: "That ingredient isn't there anymore. Refresh the page." };
  revalidate();
  revalidatePath("/admin/reports");
  return { ok: true };
}

// The pour cost suggested prices aim for (0.20 is 20%). Owners and admins.
export async function setTargetPourCost(target: number): Promise<Result> {
  const { no, employeeId } = await notOwner();
  if (no) return no;
  const t = validTarget(target);
  if (t === null) return { ok: false, error: "Pick a target between 5% and 60%." };
  const { error } = await createAdminClient()
    .from("settings")
    .upsert({ key: TARGET_POUR_COST_SETTING, value: Math.round(t * 1000) / 1000, updated_at: new Date().toISOString(), updated_by: employeeId }, { onConflict: "key" });
  if (error) return { ok: false, error: "Couldn't save the target. Try again." };
  revalidate();
  return { ok: true };
}

// "Make this a menu item": a Bar Book drink that isn't on the menu becomes
// one, in the Cocktails section under Alcohol, at this price, through the
// same insert Back office → Menu uses. Its recipe becomes the item's, so it
// shows as a tile on the Bar tab and rings up like any drink. Owners and
// admins only: it puts a new price on the register.
export async function makeMenuItemFromRecipe(recipeId: string, price: number): Promise<Result> {
  const { no } = await notOwner();
  if (no) return no;
  if (!isId(recipeId)) return { ok: false, error: "That drink isn't there anymore. Refresh and try again." };
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price >= 1000) return { ok: false, error: "Enter a price, like 9." };
  const amount = Math.round(price * 100) / 100;
  const supabase = createAdminClient();

  const [{ data: recipe, error: recipeErr }, { data: cats, error: catErr }] = await Promise.all([
    supabase.from("recipes").select("id, name, menu_item_id").eq("id", recipeId).maybeSingle(),
    supabase.from("menu_categories").select("id, key, label, parent_id, sort_order").order("sort_order"),
  ]);
  if (recipeErr || catErr) return { ok: false, error: "Couldn't read the menu. Try again." };
  if (!recipe || recipe.menu_item_id) return { ok: false, error: "That drink is already on the menu, or isn't in the book anymore. Refresh and look again." };
  const name = String(recipe.name ?? "").trim();
  if (!name) return { ok: false, error: "That drink has no name. Give it one in Back office → Bar Book." };
  const bar = (cats ?? []).find((c) => !c.parent_id && isBarCategory(c));
  const cocktails = bar ? (cats ?? []).find((c) => c.parent_id === bar.id && barSectionOf(c) === "cocktails") : undefined;
  if (!cocktails) return { ok: false, error: "There's no Cocktails section under Alcohol. Add one in Back office → Menu first." };

  const { id: itemId, error } = await insertMenuItem({ categoryId: cocktails.id as string, name, price: amount, isAlcohol: true });
  if (error || !itemId) return { ok: false, error: "Couldn't add it to the menu. Try again." };
  // Its recipe is the new item's now. Only if it's still off the menu: if
  // someone beat us to it, the new item comes back off.
  const { data: linked, error: linkErr } = await supabase.from("recipes").update({ menu_item_id: itemId, source: "menu" }).eq("id", recipeId).is("menu_item_id", null).select("id");
  if (linkErr || !linked?.length) {
    // Never when a recipe did land on it (deleting the item deletes its recipe).
    const { data: holds, error: holdErr } = await supabase.from("recipes").select("id").eq("menu_item_id", itemId).limit(1);
    if (!holdErr && !holds?.length) await supabase.from("menu_items").delete().eq("id", itemId);
    return { ok: false, error: "Couldn't link the recipe to the new menu item, so nothing was added. Refresh and try again." };
  }
  findPictureLater("item", itemId);
  revalidate();
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/pos");
  return { ok: true };
}

export async function setIngredientBar(id: string, fields: { kind?: string | null; family?: string | null; carried?: boolean }): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!isId(id)) return { ok: false, error: "That ingredient isn't there anymore. Refresh the page." };
  const patch: { kind?: string | null; family?: string | null; carried?: boolean } = {};
  if (fields.kind !== undefined) {
    if (fields.kind !== null && !isKind(fields.kind)) return { ok: false, error: "Pick a kind from the list." };
    patch.kind = fields.kind;
  }
  if (fields.family !== undefined) {
    if (fields.family !== null && !isFamily(fields.family)) return { ok: false, error: "Pick a color from the list." };
    patch.family = fields.family;
  }
  if (fields.carried !== undefined) {
    if (typeof fields.carried !== "boolean") return { ok: false, error: "Couldn't save that change. Try again." };
    patch.carried = fields.carried;
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  const { data, error } = await createAdminClient().from("ingredients").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: "Couldn't save that change. Try again." };
  if (!data?.length) return { ok: false, error: "That ingredient isn't there anymore. Refresh the page." };
  revalidate();
  return { ok: true };
}

export interface BookDrinkInput {
  id?: string | null; // to change one; none to add
  name: string;
  glass: GlassKey;
  method: Method;
  ice: Ice;
  garnishes: string[];
  description: string;
  instructions: string;
  lines: { ingredientId: string; quantity: number; optional: boolean }[];
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// Adds a drink to the book, or changes one that isn't on the menu. Its
// ingredient lines are replaced as a whole.
export async function saveBookDrink(input: BookDrinkInput): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const name = clean(input?.name, 80);
  if (!name) return { ok: false, error: "Give the drink a name." };
  if (!isGlass(input.glass)) return { ok: false, error: "Pick a glass." };
  if (!isMethod(input.method)) return { ok: false, error: "Pick how it's made." };
  if (!isIce(input.ice)) return { ok: false, error: "Pick the ice." };
  const garnishes = (Array.isArray(input.garnishes) ? input.garnishes : []).map((g) => clean(g, 40)).filter(Boolean).slice(0, 6);
  const description = clean(input.description, 400) || null;
  const instructions = typeof input.instructions === "string" ? input.instructions.trim().slice(0, 1000) || null : null;
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return { ok: false, error: "Add at least one ingredient." };
  if (lines.length > 15) return { ok: false, error: "That's a lot of ingredients. Keep it to 15." };
  const seen = new Set<string>();
  for (const l of lines) {
    if (!isId(l?.ingredientId)) return { ok: false, error: "Pick an ingredient for every line." };
    if (seen.has(l.ingredientId)) return { ok: false, error: "Each ingredient can be on the drink once." };
    seen.add(l.ingredientId);
    if (typeof l.quantity !== "number" || !Number.isFinite(l.quantity) || l.quantity < 0.001 || l.quantity > 64) return { ok: false, error: "Each amount should be a number more than 0." };
  }

  const supabase = createAdminClient();
  const fields = { name, glassware: GLASS_LABEL[input.glass], method: input.method, ice: input.ice, garnishes, garnish: garnishes.join(", ") || null, description, instructions };
  let recipeId: string;
  if (input.id) {
    if (!isId(input.id)) return { ok: false, error: "That drink isn't there anymore. Refresh the page." };
    const { data, error } = await supabase.from("recipes").update(fields).eq("id", input.id).is("menu_item_id", null).select("id");
    if (error) return { ok: false, error: error.code === "23505" ? "A drink with that name is already in the book." : "Couldn't save that drink. Try again." };
    if (!data?.length) return { ok: false, error: "That drink isn't there anymore, or it's on the menu (change it in Menu). Refresh the page." };
    recipeId = input.id;
  } else {
    const { data, error } = await supabase.from("recipes").insert({ ...fields, menu_item_id: null, source: "house" }).select("id").single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "A drink with that name is already in the book." : "Couldn't add that drink. Try again." };
    recipeId = data.id as string;
  }

  const { error: delError } = await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId);
  if (delError) return { ok: false, error: "Saved the drink, but not its ingredients. Try again." };
  const { error: lineError } = await supabase
    .from("recipe_ingredients")
    .insert(lines.map((l, i) => ({ recipe_id: recipeId, ingredient_id: l.ingredientId, quantity: Math.round(l.quantity * 1000) / 1000, optional: l.optional === true, sort_order: i })));
  if (lineError) return { ok: false, error: "Saved the drink, but not its ingredients. Try again." };
  revalidate();
  return { ok: true };
}

// Takes a drink out of the book. Only ones that aren't on the menu (a menu
// item's recipe goes with the item).
export async function deleteBookDrink(id: string): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!isId(id)) return { ok: false, error: "That drink isn't there anymore. Refresh the page." };
  const { error } = await createAdminClient().from("recipes").delete().eq("id", id).is("menu_item_id", null);
  if (error) return { ok: false, error: "Couldn't remove that drink. Try again." };
  revalidate();
  return { ok: true };
}
