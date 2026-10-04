"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import { GLASS_LABEL, isFamily, isGlass, isIce, isKind, isMethod, type GlassKey, type Ice, type Method } from "@/lib/bar/icons";

// Back office → Bar Book: managers and up set what an ingredient is (kind,
// color family, carried) and add or change the book's own drinks (no menu
// item). Every input is checked here: the browser could send anything.

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

async function denied(): Promise<Result | null> {
  const staff = await getStaffSession();
  if (!staff) return { ok: false, error: "Your staff session has expired. Sign in again." };
  if (!hasManagerAccess(staff.role)) return { ok: false, error: "Only a manager can change the Bar Book. Ask a manager to make this change." };
  return null;
}

function revalidate() {
  revalidatePath("/admin/bar-book");
  revalidatePath("/admin/ingredients");
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
