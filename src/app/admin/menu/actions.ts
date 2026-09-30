"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slugify";
import type { IngredientUnit, ModifierType, EventPriceMode } from "@/lib/types";
import { getStaffSession, hasManagerAccess, type StaffSession } from "@/lib/auth";
import { logOpsChange } from "@/lib/ops/changes";

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

async function signedInManager(): Promise<{ staff: StaffSession; no: null } | { staff: null; no: Result }> {
  const staff = await getStaffSession();
  if (!staff) return { staff: null, no: { ok: false, error: "Your staff session has expired. Sign in again." } };
  if (!hasManagerAccess(staff.role)) return { staff: null, no: { ok: false, error: "Only a manager can change the menu. Ask a manager to make this change." } };
  return { staff, no: null };
}

async function denied(): Promise<Result | null> {
  return (await signedInManager()).no;
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

// "Staff must pick": the group starts with nothing chosen and the register
// won't add the item until one is. Only for choose-one groups.
export async function setModifierGroupMustChoose(id: string, mustChoose: boolean): Promise<Result> {
  const no = await denied();
  if (no) return no;
  const { error } = await createAdminClient().from("menu_modifier_groups").update({ must_choose: !!mustChoose }).eq("id", id).eq("type", "single");
  const f = failed(error, "save that setting");
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

// Puts one ingredient line on a menu item's recipe (or changes its amount,
// if it's already there).
async function addLine(supabase: ReturnType<typeof createAdminClient>, menuItemId: string, ingredientId: string, quantity: number): Promise<Result> {
  const recipeId = await ensureRecipeId(supabase, menuItemId);
  if (!recipeId) return { ok: false, error: "Couldn't save the recipe. Try again." };
  const { count } = await supabase.from("recipe_ingredients").select("id", { count: "exact", head: true }).eq("recipe_id", recipeId);
  const { error } = await supabase
    .from("recipe_ingredients")
    .upsert({ recipe_id: recipeId, ingredient_id: ingredientId, quantity, sort_order: count ?? 0 }, { onConflict: "recipe_id,ingredient_id" });
  return failed(error, "add that ingredient") ?? { ok: true };
}

export async function addRecipeIngredient(menuItemId: string, ingredientId: string, quantity: number): Promise<Result> {
  const no = await denied();
  if (no) return no;
  if (!(quantity > 0)) return { ok: false, error: "Enter how much goes in (more than 0)." };
  const r = await addLine(createAdminClient(), menuItemId, ingredientId, quantity);
  if (!r.ok) return r;
  revalidate();
  return { ok: true };
}

// ---------- new ingredients from the recipe editor ----------
// A recipe often needs something the ingredient list doesn't have yet
// (Torani vanilla syrup, popping oil, the paper bag popcorn goes in). The
// recipe editor can turn a par sheet line into an ingredient, or add a
// brand-new ingredient and put it on the par sheet, and add it to the
// recipe, all in one step. Everything that comes in is checked here: these
// are called from the browser, so nothing about the input is trusted.

const UNITS: readonly IngredientUnit[] = ["oz", "ml", "count"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Text with the spaces tidied, or "" for anything that isn't text.
function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function tooLong(what: string, value: string, max: number): Result | null {
  return value.length > max ? { ok: false, error: `Keep the ${what} under ${max} characters.` } : null;
}

function badQuantity(quantity: unknown): Result | null {
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0 && quantity < 10000
    ? null
    : { ok: false, error: "Enter how much goes in (more than 0)." };
}

function badUnit(unit: unknown): Result | null {
  return UNITS.includes(unit as IngredientUnit) ? null : { ok: false, error: "Pick how it's measured: oz, ml or count." };
}

async function menuItemName(supabase: ReturnType<typeof createAdminClient>, menuItemId: unknown): Promise<string | null> {
  if (typeof menuItemId !== "string" || !UUID.test(menuItemId)) return null;
  const { data } = await supabase.from("menu_items").select("name").eq("id", menuItemId).maybeSingle();
  return data ? (data.name as string) : null;
}

type IngredientRow = { id: string; name: string; active: boolean; par_item_id: string | null };

// The ingredient with this name, ignoring case (names are unique that way).
async function ingredientNamed(supabase: ReturnType<typeof createAdminClient>, name: string): Promise<IngredientRow | null | "error"> {
  const { data, error } = await supabase.from("ingredients").select("id, name, active, par_item_id");
  if (error) {
    console.error("menu: ingredients not read", error);
    return "error";
  }
  const key = name.toLowerCase();
  return ((data ?? []) as IngredientRow[]).find((i) => i.name.toLowerCase() === key) ?? null;
}

// Reusing an ingredient: switch it back on if it was deactivated, and link
// it to the par sheet line if it isn't linked to one yet.
async function reuseIngredient(supabase: ReturnType<typeof createAdminClient>, existing: IngredientRow, parItemId: string | null): Promise<Result> {
  const patch: { active?: boolean; par_item_id?: string } = {};
  if (!existing.active) patch.active = true;
  if (parItemId && !existing.par_item_id) patch.par_item_id = parItemId;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from("ingredients").update(patch).eq("id", existing.id);
  return failed(error, "update that ingredient") ?? { ok: true };
}

export interface NewIngredientFields {
  name: string;
  unit: IngredientUnit;
  category: string | null;
}

export interface NewParLine {
  area: string;
  section: string | null;
  par_qty: number | null;
  unit: string | null;
  source: string | null;
}

// A par sheet line picked in the recipe editor becomes an ingredient
// (linked to that line) and goes on the recipe.
export async function addRecipeIngredientFromPar(
  menuItemId: string,
  parItemId: string,
  fields: { unit: IngredientUnit; category: string | null },
  quantity: number,
): Promise<Result> {
  const { no } = await signedInManager();
  if (no) return no;
  const bad = badUnit(fields?.unit) ?? badQuantity(quantity);
  if (bad) return bad;
  const category = clean(fields?.category);
  const long = tooLong("category", category, 40);
  if (long) return long;

  const supabase = createAdminClient();
  if (!(await menuItemName(supabase, menuItemId))) return { ok: false, error: "That menu item isn't there anymore. Refresh the page." };
  if (typeof parItemId !== "string" || !UUID.test(parItemId)) return { ok: false, error: "Pick something from the list." };
  const { data: par } = await supabase.from("par_items").select("id, name, active").eq("id", parItemId).maybeSingle();
  if (!par || !par.active) return { ok: false, error: "That isn't on the par sheet anymore. Refresh the page and try again." };

  // Someone may have linked it (or made an ingredient with the same name)
  // since the page loaded; use that one instead of making a second.
  const { data: linked } = await supabase.from("ingredients").select("id, name, active, par_item_id").eq("par_item_id", par.id).limit(1);
  const already = (linked?.[0] as IngredientRow | undefined) ?? (await ingredientNamed(supabase, clean(par.name)));
  if (already === "error") return { ok: false, error: "Couldn't add that ingredient. Try again." };

  let ingredientId: string;
  if (already) {
    const r = await reuseIngredient(supabase, already, par.id);
    if (!r.ok) return r;
    ingredientId = already.id;
  } else {
    const { data: created, error } = await supabase
      .from("ingredients")
      .insert({ name: clean(par.name), unit: fields.unit, category: category || null, par_item_id: par.id })
      .select("id")
      .single();
    if (error?.code === "23505") return { ok: false, error: `Someone just added "${clean(par.name)}". Refresh the page and pick it from the list.` };
    const f = failed(error, "add that ingredient");
    if (f) return f;
    ingredientId = created!.id as string;
  }

  const r = await addLine(supabase, menuItemId, ingredientId, quantity);
  if (!r.ok) return r;
  revalidate();
  revalidatePath("/admin/ingredients");
  return { ok: true };
}

// A brand-new ingredient, typed into the recipe editor: optionally put on
// the par sheet (so it gets counted and bought), then added to the recipe.
// If an ingredient with that name already exists, that one is used.
export async function addNewRecipeIngredient(
  menuItemId: string,
  fields: NewIngredientFields,
  parLine: NewParLine | null,
  quantity: number,
): Promise<Result> {
  const { staff, no } = await signedInManager();
  if (no) return no;
  const name = clean(fields?.name);
  const category = clean(fields?.category);
  if (!name) return { ok: false, error: "Give the ingredient a name." };
  const bad = tooLong("name", name, 80) ?? tooLong("category", category, 40) ?? badUnit(fields?.unit) ?? badQuantity(quantity);
  if (bad) return bad;

  let par: { area: string; section: string | null; par_qty: number | null; unit: string | null; source: string | null } | null = null;
  if (parLine !== null && parLine !== undefined) {
    if (typeof parLine !== "object") return { ok: false, error: "Something's off with the par sheet part. Refresh the page and try again." };
    const area = clean(parLine.area);
    const section = clean(parLine.section);
    const unit = clean(parLine.unit);
    const source = clean(parLine.source);
    const qty = parLine.par_qty;
    if (!area) return { ok: false, error: "Pick which par sheet it goes on (Bar, Coffee, Concessions...)." };
    const parBad =
      tooLong("section", section, 60) ??
      tooLong("par unit", unit, 40) ??
      tooLong("store name", source, 60) ??
      (qty !== null && !(typeof qty === "number" && Number.isFinite(qty) && qty >= 0 && qty < 100000)
        ? { ok: false as const, error: "Par should be a number, like 1 or 0.5, or left blank." }
        : null);
    if (parBad) return parBad;
    par = { area, section: section || null, par_qty: qty, unit: unit || null, source: source || null };
  }

  const supabase = createAdminClient();
  const itemName = await menuItemName(supabase, menuItemId);
  if (!itemName) return { ok: false, error: "That menu item isn't there anymore. Refresh the page." };
  if (par) {
    // Only sheets that already exist; a new sheet is made from the register.
    const { data: sheet } = await supabase.from("par_items").select("id").eq("area", par.area).limit(1);
    if (!sheet || sheet.length === 0) return { ok: false, error: `There's no "${par.area}" par sheet. Pick one from the list.` };
  }

  const existing = await ingredientNamed(supabase, name);
  if (existing === "error") return { ok: false, error: "Couldn't add that ingredient. Try again." };
  const wantParLine = par !== null && !(existing && existing.par_item_id);

  // The par sheet line: an unlinked one with the same name on that sheet,
  // or a new one at the end of its section.
  let parItemId: string | null = null;
  let madeParLine = false;
  if (wantParLine && par) {
    const [{ data: sameName }, { data: taken }] = await Promise.all([
      supabase.from("par_items").select("id, name").eq("area", par.area).eq("active", true),
      supabase.from("ingredients").select("par_item_id").not("par_item_id", "is", null),
    ]);
    const takenIds = new Set((taken ?? []).map((t) => t.par_item_id as string));
    const match = (sameName ?? []).find((p) => clean(p.name).toLowerCase() === name.toLowerCase() && !takenIds.has(p.id as string));
    if (match) {
      parItemId = match.id as string;
    } else {
      const q = supabase.from("par_items").select("sort_order").eq("area", par.area).order("sort_order", { ascending: false }).limit(1);
      const { data: last } = par.section ? await q.eq("section", par.section) : await q;
      const { data: line, error } = await supabase
        .from("par_items")
        .insert({
          area: par.area,
          section: par.section,
          name,
          par_qty: par.par_qty,
          unit: par.unit,
          source: par.source,
          sort_order: ((last?.[0]?.sort_order as number | undefined) ?? 0) + 1,
          created_by: staff.employeeId,
          updated_by: staff.employeeId,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      const f = failed(error, "put it on the par sheet");
      if (f) return f;
      parItemId = line!.id as string;
      madeParLine = true;
    }
  }

  let ingredientId: string;
  if (existing) {
    const r = await reuseIngredient(supabase, existing, parItemId);
    if (!r.ok) {
      if (madeParLine) await supabase.from("par_items").delete().eq("id", parItemId!);
      return r;
    }
    ingredientId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from("ingredients")
      .insert({ name, unit: fields.unit, category: category || null, par_item_id: parItemId })
      .select("id")
      .single();
    if (error) {
      // Don't leave a par line behind for an ingredient that didn't get made.
      if (madeParLine) await supabase.from("par_items").delete().eq("id", parItemId!);
      if (error.code === "23505") return { ok: false, error: `There's already an ingredient called "${name}". Refresh the page and pick it from the list.` };
      return failed(error, "add that ingredient")!;
    }
    ingredientId = created.id as string;
  }

  if (madeParLine && par) {
    await logOpsChange("par_item", parItemId, "added", `Par item "${name}" (${par.area}), added from the recipe for ${itemName}`, staff.employeeId);
  }

  const r = await addLine(supabase, menuItemId, ingredientId, quantity);
  if (!r.ok) return r;
  revalidate();
  revalidatePath("/admin/ingredients");
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
