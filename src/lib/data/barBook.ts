import { createAdminClient } from "@/lib/supabase/admin";
import { schemaMissing } from "@/lib/schema-missing";
import {
  asMethod,
  bookLineFrom,
  garnishList,
  nameKey,
  recipeCard,
  type BoardEntry,
  type BookLine,
  type BookRecipe,
  type BookStock,
  type RecipeSource,
} from "@/lib/bar/book";
import { barSectionOf, isBarCategory, itemIconSpec } from "@/lib/bar/menu";
import { iconSpecFor, type BarSection } from "@/lib/bar/icons";
import { doubleUpcharge, hasLiquorChoice, hasOwnDouble, sectionOfCategory, type DoubleSettings } from "@/lib/bar/double";
import { getRecipesByItem } from "@/lib/data/recipes";
import { BAR_PRICES_SETTING, DEFAULT_TARGET_POUR_COST, TARGET_POUR_COST_SETTING, drinkCost, readBarPrices, validTarget, type BarPrices, type DrinkCost } from "@/lib/bar/pricing";

// The Bar Book's data (server only: it reads with the service role). The
// "can we make it?" logic is plain functions in src/lib/bar/book.ts, so the
// register and the bar display can run it.
//
// Before the Bar Book migration (20261004010000) is applied these return
// null (the register hides the book) or a map from the old recipe columns
// (the bar display), so nothing breaks in between.

type LineRow = {
  ingredient_id: string;
  quantity: number;
  sort_order: number;
  optional?: boolean | null;
  ingredient: { name: string; unit: string; family?: string | null; kind?: string | null } | null;
};

type RecipeRow = {
  id: string;
  menu_item_id: string | null;
  name?: string | null;
  source?: string | null;
  glassware: string | null;
  garnish: string | null;
  garnishes?: string[] | null;
  method?: string | null;
  ice?: string | null;
  description?: string | null;
  instructions: string | null;
  menu_item?: { name: string } | null;
  ingredients: LineRow[];
};

const BOOK_COLUMNS =
  "id, menu_item_id, name, source, glassware, garnish, garnishes, method, ice, description, instructions, menu_item:menu_items(name), ingredients:recipe_ingredients(ingredient_id, quantity, sort_order, optional, ingredient:ingredients(name, unit, family, kind))";
const OLD_COLUMNS = "id, menu_item_id, glassware, garnish, instructions, menu_item:menu_items(name), ingredients:recipe_ingredients(ingredient_id, quantity, sort_order, ingredient:ingredients(name, unit))";

function toRecipe(r: RecipeRow): BookRecipe | null {
  const name = (r.name ?? r.menu_item?.name ?? "").trim();
  if (!name) return null;
  const source: RecipeSource = r.source === "house" || r.source === "seed" ? r.source : "menu";
  return {
    id: r.id,
    menuItemId: r.menu_item_id,
    name,
    source: r.menu_item_id ? "menu" : source,
    glassware: r.glassware,
    method: asMethod(r.method),
    ice: r.ice ?? null,
    garnishes: garnishList(r.garnishes, r.garnish),
    description: r.description ?? null,
    instructions: r.instructions,
    lines: [...(r.ingredients ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(bookLineFrom)
      .filter((l): l is BookLine => !!l),
  };
}

export interface BarBookData {
  recipes: BookRecipe[];
  stock: BookStock[];
  target: number; // the target pour cost for suggested prices
}

export interface MenuDouble {
  id: string;
  name: string;
  section: BarSection | null;
  price: number;
  upcharge: number | null; // null: no double (beer, wine, nothing to double)
}

// Back office → Bar Book → Prices: what a double of each alcohol drink on
// the menu costs right now, from its section, its recipe and the sheet.
export async function getMenuDoubles(settings: DoubleSettings): Promise<MenuDouble[]> {
  const supabase = createAdminClient();
  const [items, cats, groups, recipes] = await Promise.all([
    supabase.from("menu_items").select("id, name, price, category_id, is_alcohol, active, sort_order").eq("is_alcohol", true).eq("active", true).order("sort_order"),
    supabase.from("menu_categories").select("id, key, label, parent_id, sort_order").order("sort_order"),
    supabase.from("menu_modifier_groups").select("item_id, key, label, options:menu_modifier_options(name)"),
    getRecipesByItem(),
  ]);
  if (items.error || cats.error) return [];
  const categories = (cats.data ?? []) as { id: string; key: string | null; label: string | null; parent_id: string | null }[];
  type G = { item_id: string; key: string | null; label: string | null; options: { name: string }[] };
  const groupsByItem = new Map<string, G[]>();
  for (const g of (groups.data ?? []) as unknown as G[]) groupsByItem.set(g.item_id, [...(groupsByItem.get(g.item_id) ?? []), g]);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  return ((items.data ?? []) as { id: string; name: string; price: number; category_id: string; is_alcohol: boolean }[])
    .sort((a, b) => (order.get(a.category_id) ?? 0) - (order.get(b.category_id) ?? 0))
    .map((i) => {
      const section = sectionOfCategory(i.category_id, categories, isBarCategory, barSectionOf);
      const r = recipes[i.id];
      const recipe = r ? r.ingredients.map((x) => ({ name: x.ingredient_name, quantity: x.quantity, unit: x.unit, kind: x.kind ?? null, optional: x.optional === true })) : null;
      const g = groupsByItem.get(i.id);
      const upcharge = doubleUpcharge({ isAlcohol: true, section, ownDouble: hasOwnDouble(g), recipe, name: i.name, liquor: hasLiquorChoice(g) }, settings);
      return { id: i.id, name: i.name, section, price: Number(i.price), upcharge };
    });
}

// The Prices sheet (lib/bar/pricing.ts): settings.bar_prices and the
// target pour cost, each knob falling back to its default on its own, so
// before anyone saves the sheet the code defaults apply. Never throws.
export async function getBarPrices(): Promise<BarPrices> {
  try {
    const { data, error } = await createAdminClient().from("settings").select("key, value").in("key", [BAR_PRICES_SETTING, TARGET_POUR_COST_SETTING]);
    const rows = error ? [] : ((data ?? []) as { key: string; value: unknown }[]);
    return readBarPrices(rows.find((r) => r.key === BAR_PRICES_SETTING)?.value, rows.find((r) => r.key === TARGET_POUR_COST_SETTING)?.value);
  } catch {
    return readBarPrices(null);
  }
}

// The pour cost suggested prices aim for (Back office → Bar Book, owners
// and admins): settings.bar_target_pour_cost, 20% until someone sets it.
export async function getTargetPourCost(): Promise<number> {
  const { data, error } = await createAdminClient().from("settings").select("value").eq("key", TARGET_POUR_COST_SETTING).maybeSingle();
  if (error || !data) return DEFAULT_TARGET_POUR_COST;
  return validTarget(data.value) ?? DEFAULT_TARGET_POUR_COST;
}

// Every recipe (menu, house and the starter list) and what the bar has.
export async function getBarBookData(): Promise<BarBookData | null> {
  const supabase = createAdminClient();
  const [rec, ing, outs, counts, target, bar] = await Promise.all([
    supabase.from("recipes").select(BOOK_COLUMNS),
    supabase.from("ingredients").select("id, name, unit, kind, family, carried, active, par_item_id, unit_cost"),
    supabase.from("stock_outages").select("par_item_id, label").is("resolved_at", null).not("par_item_id", "is", null),
    // The latest count per ingredient is all that matters; the newest few
    // thousand counts cover every ingredient anyone still counts.
    supabase.from("inventory_counts").select("ingredient_id, quantity_on_hand, counted_at").order("counted_at", { ascending: false }).limit(5000),
    getTargetPourCost(),
    // Only drinks: recipes tied to food menu items (pizza, popcorn, hot dogs) stay out of the book.
    supabase.from("menu_items").select("id").eq("is_alcohol", true),
  ]);
  if (schemaMissing(rec.error) || schemaMissing(ing.error)) return null;
  if (rec.error) throw rec.error;
  if (ing.error) throw ing.error;

  const outByPar = new Map<string, string>();
  if (!outs.error) for (const o of outs.data ?? []) outByPar.set(o.par_item_id as string, o.label as string);
  const lastCount = new Map<string, number>();
  if (!counts.error) for (const c of counts.data ?? []) if (!lastCount.has(c.ingredient_id as string)) lastCount.set(c.ingredient_id as string, Number(c.quantity_on_hand));

  const stock: BookStock[] = (ing.data ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    carried: i.carried !== false && i.active !== false,
    outLabel: i.par_item_id ? (outByPar.get(i.par_item_id as string) ?? null) : null,
    lastCount: lastCount.has(i.id as string) ? lastCount.get(i.id as string)! : null,
    unitCost: i.unit_cost === null || i.unit_cost === undefined ? null : Number(i.unit_cost),
    unit: i.unit as string,
    family: (i.family as string | null) ?? null,
    kind: (i.kind as string | null) ?? null,
  }));
  const barItems = bar.error ? null : new Set((bar.data ?? []).map((m) => m.id as string));
  const recipes = ((rec.data ?? []) as unknown as RecipeRow[])
    .map(toRecipe)
    .filter((r): r is BookRecipe => !!r && (!r.menuItemId || !barItems || barItems.has(r.menuItemId)));
  return { recipes, stock, target };
}

export interface BarIngredient {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  kind: string | null;
  family: string | null;
  carried: boolean;
  active: boolean;
  unit_cost: number | null; // per unit (per oz for oz)
  bottle_size: number | null; // in its unit (25.4 oz for a 750 ml bottle)
}

// Back office → Bar Book: every ingredient with its kind, family and
// carried, and the book's drinks that aren't on the menu (house and the
// starter list). Null before the migration.
export async function getBarBookAdmin(): Promise<{ ingredients: BarIngredient[]; drinks: BookRecipe[]; target: number } | null> {
  const supabase = createAdminClient();
  const [ing, rec, target] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit, category, kind, family, carried, active, unit_cost, bottle_size").order("name"),
    supabase.from("recipes").select(BOOK_COLUMNS).is("menu_item_id", null).order("name"),
    getTargetPourCost(),
  ]);
  if (schemaMissing(ing.error) || schemaMissing(rec.error)) return null;
  if (ing.error) throw ing.error;
  if (rec.error) throw rec.error;
  return {
    ingredients: ((ing.data ?? []) as BarIngredient[]).map((i) => ({
      ...i,
      unit_cost: i.unit_cost === null ? null : Number(i.unit_cost),
      bottle_size: i.bottle_size === null ? null : Number(i.bottle_size),
    })),
    drinks: ((rec.data ?? []) as unknown as RecipeRow[]).map(toRecipe).filter((r): r is BookRecipe => !!r),
    target,
  };
}

export interface BoardEntries {
  items: Record<string, BoardEntry>; // by menu item id
  recipes: Record<string, BoardEntry>; // by recipe id: Bar Book drinks rung up off the menu
}

// The bar display's maps, read once when the board loads: each alcohol menu
// item's icon and recipe card (a beer or wine with no recipe gets its glass
// and no card; a cocktail with no recipe of its own borrows the book drink
// of the same name), and each off-menu Bar Book drink's, for the lines rung
// up from the book (order_items.recipe_id).
export async function getBoardEntries(): Promise<BoardEntries> {
  const supabase = createAdminClient();
  const [items, newer] = await Promise.all([
    supabase.from("menu_items").select("id, name, category:menu_categories(key, label)").eq("is_alcohol", true),
    supabase.from("recipes").select(BOOK_COLUMNS),
  ]);
  const none: BoardEntries = { items: {}, recipes: {} };
  if (items.error) return none;
  let rows = newer.data as unknown as RecipeRow[] | null;
  if (newer.error) {
    if (!schemaMissing(newer.error)) return none;
    const older = await supabase.from("recipes").select(OLD_COLUMNS);
    if (older.error) return none;
    rows = older.data as unknown as RecipeRow[];
  }

  const recipes = (rows ?? []).map(toRecipe).filter((r): r is BookRecipe => !!r);
  const byItem = new Map<string, BookRecipe>();
  const byKey = new Map<string, BookRecipe>();
  for (const r of recipes) {
    if (r.menuItemId) byItem.set(r.menuItemId, r);
    else if (!byKey.has(nameKey(r.name))) byKey.set(nameKey(r.name), r);
  }

  const map: Record<string, BoardEntry> = {};
  for (const it of (items.data ?? []) as unknown as { id: string; name: string; category: { key: string; label: string } | null }[]) {
    const section = barSectionOf(it.category);
    const own = byItem.get(it.id);
    const r = own && own.lines.length > 0 ? own : (byKey.get(nameKey(it.name)) ?? own);
    if (!r) {
      map[it.id] = { spec: itemIconSpec(null, section), card: null };
      continue;
    }
    const spec = iconSpecFor(
      { glassware: r.glassware, garnishes: r.garnishes, ice: r.ice, ingredients: r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, family: l.family, kind: l.kind })) },
      section,
    );
    const hasCard = r.lines.length > 0 || !!r.instructions;
    map[it.id] = { spec, card: hasCard ? recipeCard({ ...r, name: it.name }) : null };
  }

  // The board's recipe overlay doesn't show the description, so it stays home.
  const byRecipe: Record<string, BoardEntry> = {};
  for (const r of recipes) {
    if (r.menuItemId) continue;
    const spec = iconSpecFor(
      { glassware: r.glassware, garnishes: r.garnishes, ice: r.ice, ingredients: r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, family: l.family, kind: l.kind })) },
      "cocktails",
    );
    byRecipe[r.id] = { spec, card: r.lines.length > 0 || r.instructions ? { ...recipeCard(r), description: null } : null };
  }
  return { items: map, recipes: byRecipe };
}

// ---------- custom drinks on an order ("What's in it?") ----------

export type KnownIngredient = { name: string; unit: string; family: string | null; kind: string | null; unitCost: number | null };

// The ingredients a register order's custom drinks name
// (order_items.custom_recipe), looked up so the server keeps only real ones
// and writes their names, units and colors itself. Never throws: an empty
// map drops every list, and the lines save as plain custom lines.
export async function customIngredientsFor(lines: readonly { custom_recipe?: unknown }[]): Promise<Map<string, KnownIngredient>> {
  const ids = new Set<string>();
  for (const l of lines) {
    if (!Array.isArray(l.custom_recipe)) continue;
    for (const r of l.custom_recipe.slice(0, 12)) {
      const id = r && typeof r === "object" ? (r as { ingredient_id?: unknown }).ingredient_id : null;
      if (typeof id === "string" && UUID.test(id)) ids.add(id.toLowerCase());
    }
  }
  const found = new Map<string, KnownIngredient>();
  if (!ids.size) return found;
  try {
    const supabase = createAdminClient();
    const full = await supabase.from("ingredients").select("id, name, unit, family, kind, unit_cost").in("id", [...ids]);
    let rows = full.data as { id: string; name: string; unit: string; family?: string | null; kind?: string | null; unit_cost: number | null }[] | null;
    if (full.error) {
      if (!schemaMissing(full.error)) return found;
      const plain = await supabase.from("ingredients").select("id, name, unit, unit_cost").in("id", [...ids]);
      if (plain.error) return found;
      rows = plain.data as typeof rows;
    }
    for (const r of rows ?? []) {
      found.set(r.id.toLowerCase(), { name: r.name, unit: r.unit, family: r.family ?? null, kind: r.kind ?? null, unitCost: r.unit_cost === null ? null : Number(r.unit_cost) });
    }
  } catch {
    // As if none were found.
  }
  return found;
}

// ---------- Bar Book drinks on an order ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The recipes a register order's lines may carry (order_items.recipe_id):
// only a one-off line (no menu item, not a ticket) naming a real Bar Book
// drink that isn't on the menu. Anything else is dropped by the caller.
// Each with what it costs, for the below-cost check. Never throws: an empty
// map means every recipe_id is dropped and the lines save as plain custom
// lines, exactly as before.
export async function bookRecipesFor(
  lines: readonly { menu_item_id: string | null; screening_id?: string | null; recipe_id?: string | null }[],
): Promise<Map<string, { name: string; cost: DrinkCost }>> {
  const ids = [
    ...new Set(lines.filter((l) => !l.menu_item_id && !l.screening_id && typeof l.recipe_id === "string" && UUID.test(l.recipe_id)).map((l) => (l.recipe_id as string).toLowerCase())),
  ];
  const found = new Map<string, { name: string; cost: DrinkCost }>();
  if (!ids.length) return found;
  try {
    const { data, error } = await createAdminClient()
      .from("recipes")
      .select("id, name, menu_item_id, ingredients:recipe_ingredients(quantity, optional, ingredient:ingredients(name, unit_cost))")
      .in("id", ids)
      .is("menu_item_id", null);
    if (error) return found;
    for (const r of (data ?? []) as unknown as {
      id: string;
      name: string | null;
      ingredients: { quantity: number; optional: boolean | null; ingredient: { name: string; unit_cost: number | null } | null }[];
    }[]) {
      const cost = drinkCost(
        (r.ingredients ?? []).map((l) => ({ name: l.ingredient?.name ?? "?", quantity: Number(l.quantity), unitCost: l.ingredient?.unit_cost ?? null, optional: l.optional === true })),
      );
      found.set(r.id.toLowerCase(), { name: r.name ?? "", cost });
    }
  } catch {
    // As if none were found: the lines save as plain custom lines.
  }
  return found;
}
