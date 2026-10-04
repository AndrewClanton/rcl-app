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
import { barSectionOf, itemIconSpec } from "@/lib/bar/menu";
import { iconSpecFor } from "@/lib/bar/icons";

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
}

// Every recipe (menu, house and the starter list) and what the bar has.
export async function getBarBookData(): Promise<BarBookData | null> {
  const supabase = createAdminClient();
  const [rec, ing, outs, counts] = await Promise.all([
    supabase.from("recipes").select(BOOK_COLUMNS),
    supabase.from("ingredients").select("id, name, carried, active, par_item_id"),
    supabase.from("stock_outages").select("par_item_id, label").is("resolved_at", null).not("par_item_id", "is", null),
    // The latest count per ingredient is all that matters; the newest few
    // thousand counts cover every ingredient anyone still counts.
    supabase.from("inventory_counts").select("ingredient_id, quantity_on_hand, counted_at").order("counted_at", { ascending: false }).limit(5000),
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
  }));
  const recipes = ((rec.data ?? []) as unknown as RecipeRow[]).map(toRecipe).filter((r): r is BookRecipe => !!r);
  return { recipes, stock };
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
}

// Back office → Bar Book: every ingredient with its kind, family and
// carried, and the book's drinks that aren't on the menu (house and the
// starter list). Null before the migration.
export async function getBarBookAdmin(): Promise<{ ingredients: BarIngredient[]; drinks: BookRecipe[] } | null> {
  const supabase = createAdminClient();
  const [ing, rec] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit, category, kind, family, carried, active").order("name"),
    supabase.from("recipes").select(BOOK_COLUMNS).is("menu_item_id", null).order("name"),
  ]);
  if (schemaMissing(ing.error) || schemaMissing(rec.error)) return null;
  if (ing.error) throw ing.error;
  if (rec.error) throw rec.error;
  return {
    ingredients: (ing.data ?? []) as BarIngredient[],
    drinks: ((rec.data ?? []) as unknown as RecipeRow[]).map(toRecipe).filter((r): r is BookRecipe => !!r),
  };
}

// The bar display's map: menu item id → its icon and recipe card, for every
// alcohol item on the menu. A beer or wine with no recipe gets its glass and
// no card; a cocktail with no recipe of its own borrows the book drink of
// the same name. Read once when the board loads.
export async function getBoardEntries(): Promise<Record<string, BoardEntry>> {
  const supabase = createAdminClient();
  const [items, newer] = await Promise.all([
    supabase.from("menu_items").select("id, name, category:menu_categories(key, label)").eq("is_alcohol", true),
    supabase.from("recipes").select(BOOK_COLUMNS),
  ]);
  if (items.error) return {};
  let rows = newer.data as unknown as RecipeRow[] | null;
  if (newer.error) {
    if (!schemaMissing(newer.error)) return {};
    const older = await supabase.from("recipes").select(OLD_COLUMNS);
    if (older.error) return {};
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
  return map;
}
