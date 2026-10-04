// The Bar Book's "can we make it?" (The Royale Bar Book, phase 3): plain
// functions over recipes and stock, worked out live and never stored.
//
// Client-safe: no server imports, so the register and the bar display can
// use it. The database loader is src/lib/data/barBook.ts.
//
// A drink is makeable when every required ingredient is carried, isn't on
// an open "Ran out" (through its par sheet line), and wasn't last counted at
// zero (where it's been counted at all). Optional ingredients (a garnish, a
// float) never stop it. scripts/check-bar-book.mjs checks all of this.
import {
  familyFor,
  GLASS_LABEL,
  iconSpecFor,
  isFamily,
  isKind,
  isMethod,
  kindFor,
  METHOD_LABEL,
  normalizeGlass,
  type Family,
  type GlassKey,
  type IconSpec,
  type Kind,
  type Method,
} from "@/lib/bar/icons";

export type RecipeSource = "menu" | "house" | "seed";

// One ingredient as the book sees it.
export interface BookStock {
  id: string;
  name: string;
  carried: boolean; // the bar stocks it (and it's not deactivated)
  outLabel: string | null; // an open Ran out on its par line: what was reported
  lastCount: number | null; // the latest shelf count, if it's ever been counted
}

export interface BookLine {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string; // oz, ml or count
  optional: boolean;
  family: Family | null;
  kind: Kind | null;
}

// A recipe as the loader returns it.
export interface BookRecipe {
  id: string;
  menuItemId: string | null;
  name: string; // its own name, or its menu item's
  source: RecipeSource;
  glassware: string | null;
  method: Method | null;
  ice: string | null;
  garnishes: string[];
  description: string | null;
  instructions: string | null;
  lines: BookLine[];
}

export interface MenuRef {
  id: string;
  name: string;
  price: number;
}

// A drink in the book, ready to show.
export interface BookDrink extends BookRecipe {
  key: string; // its name, normalized (one drink per name)
  glass: GlassKey | null;
  spec: IconSpec;
  base: Family | null;
  menu: MenuRef | null; // the register item it rings up as, if it's on our menu
}

// ---------- names ----------

// "Dark 'n' Stormy" and "dark and stormy" are one drink.
export function nameKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\s'n'?\s|\sn'\s/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The letter a drink is filed under: A–Z, else #.
export function letterOf(name: string): string {
  const c = nameKey(name).charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

// ---------- can we make it? ----------

export type LineState = "ok" | "missing" | "out" | "none-left";

export function lineState(line: Pick<BookLine, "ingredientId">, stock: ReadonlyMap<string, BookStock>): LineState {
  const s = stock.get(line.ingredientId);
  if (!s || !s.carried) return "missing";
  if (s.outLabel) return "out";
  if (s.lastCount !== null && Number.isFinite(s.lastCount) && s.lastCount <= 0) return "none-left";
  return "ok";
}

export const LINE_LABEL: Record<LineState, string> = { ok: "In stock", missing: "Not carried", out: "Ran out", "none-left": "Counted 0" };

export interface DrinkStatus {
  state: "ok" | "missing" | "out";
  label: string; // "Can make", "No Cointreau", "Gin ran out", "Out of gin"
  ingredient: string | null;
}

const required = (d: { lines: readonly BookLine[] }) => d.lines.filter((l) => !l.optional);

// Missing comes first (we don't carry it at all), then the first that ran
// out or was counted at zero.
export function drinkStatus(drink: { lines: readonly BookLine[] }, stock: ReadonlyMap<string, BookStock>): DrinkStatus {
  const lines = required(drink);
  const missing = lines.find((l) => lineState(l, stock) === "missing");
  if (missing) return { state: "missing", label: `No ${missing.name}`, ingredient: missing.name };
  for (const l of lines) {
    const st = lineState(l, stock);
    if (st === "out") return { state: "out", label: `${l.name} ran out`, ingredient: l.name };
    if (st === "none-left") return { state: "out", label: `Out of ${l.name}`, ingredient: l.name };
  }
  return { state: "ok", label: "Can make", ingredient: null };
}

export function isMakeable(drink: { lines: readonly BookLine[] }, stock: ReadonlyMap<string, BookStock>): boolean {
  return drinkStatus(drink, stock).state === "ok";
}

// "Uses what we have": how much of a drink we could pour right now.
export function usesWhatWeHave(drink: { lines: readonly BookLine[] }, stock: ReadonlyMap<string, BookStock>): { share: number; have: number; need: number } {
  const lines = required(drink);
  const have = lines.filter((l) => lineState(l, stock) === "ok").length;
  return { share: lines.length ? have / lines.length : 1, have, need: lines.length };
}

// The share of required ingredients we have, then how many, then A–Z.
export function sortByWhatWeHave<T extends { name: string; lines: readonly BookLine[] }>(drinks: readonly T[], stock: ReadonlyMap<string, BookStock>): T[] {
  const score = new Map(drinks.map((d) => [d, usesWhatWeHave(d, stock)]));
  return [...drinks].sort((a, b) => {
    const x = score.get(a)!;
    const y = score.get(b)!;
    return y.share - x.share || y.have - x.have || a.name.localeCompare(b.name);
  });
}

export function sortAZ<T extends { name: string }>(drinks: readonly T[]): T[] {
  return [...drinks].sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
}

export function stockMap(stock: readonly BookStock[]): Map<string, BookStock> {
  return new Map(stock.map((s) => [s.id, s]));
}

// ---------- building the book ----------

const RANK: Record<RecipeSource, number> = { menu: 3, house: 2, seed: 1 };

// One drink per name: our menu's recipe wins over a house drink, which wins
// over the starter list. A book drink with a menu item's name rings up as
// that item. menuItems are the register's own (orderable) items, so a
// recipe whose item is hidden from the register can't be rung up.
export function buildBook(recipes: readonly BookRecipe[], menuItems: readonly MenuRef[]): BookDrink[] {
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  const byKey = new Map<string, MenuRef>();
  for (const m of menuItems) if (!byKey.has(nameKey(m.name))) byKey.set(nameKey(m.name), m);
  const best = new Map<string, BookDrink>();
  for (const r of recipes) {
    const key = nameKey(r.name);
    if (!key) continue;
    const menu = r.menuItemId ? (byId.get(r.menuItemId) ?? null) : (byKey.get(key) ?? null);
    const spec = iconSpecFor(
      { glassware: r.glassware, garnishes: r.garnishes, ice: r.ice, ingredients: r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, family: l.family, kind: l.kind })) },
      "cocktails",
    );
    const drink: BookDrink = { ...r, key, glass: normalizeGlass(r.glassware), spec, base: spec.base, menu };
    const had = best.get(key);
    const rank = (d: BookDrink) => (d.menuItemId ? 3 : RANK[d.source] ?? 0);
    if (!had || rank(drink) > rank(had)) best.set(key, drink);
  }
  return sortAZ([...best.values()]);
}

// How many drinks in the book we can make right now (the Bar tab's button).
export function countMakeable(recipes: readonly BookRecipe[], stock: readonly BookStock[], menuItems: readonly MenuRef[]): number {
  const byId = stockMap(stock);
  return buildBook(recipes, menuItems).filter((d) => isMakeable(d, byId)).length;
}

// The first few things in it, for a list row: "Tequila, Triple sec, Lime juice".
export function mainIngredients(drink: { lines: readonly BookLine[] }, n = 3): string {
  return drink.lines
    .filter((l) => !l.optional && l.kind !== "garnish" && l.unit !== "count")
    .slice(0, n)
    .map((l) => l.name)
    .join(", ");
}

// ---------- reading rows ----------

// A recipe_ingredients line from the database, with its ingredient.
export function bookLineFrom(row: {
  ingredient_id: string;
  quantity: number | string;
  optional?: boolean | null;
  ingredient: { name: string; unit: string; family?: string | null; kind?: string | null } | null;
}): BookLine | null {
  if (!row.ingredient) return null;
  const q = Number(row.quantity);
  return {
    ingredientId: row.ingredient_id,
    name: row.ingredient.name,
    quantity: Number.isFinite(q) ? q : 0,
    unit: row.ingredient.unit,
    optional: row.optional === true,
    family: isFamily(row.ingredient.family) ? row.ingredient.family : familyFor(row.ingredient.name),
    kind: isKind(row.ingredient.kind) ? row.ingredient.kind : kindFor(row.ingredient.name),
  };
}

// recipes.garnishes, else the old free-text garnish split on commas.
export function garnishList(garnishes: readonly string[] | null | undefined, garnish: string | null | undefined): string[] {
  const list = (garnishes ?? []).map((g) => g.trim()).filter(Boolean);
  if (list.length) return list;
  return (garnish ?? "")
    .split(/[,;]|\band\b/)
    .map((g) => g.trim())
    .filter(Boolean);
}

export const asMethod = (v: unknown): Method | null => (isMethod(v) ? v : null);

// ---------- the recipe card ----------

// "2 oz", "¾ oz", "1½ oz", "2 dashes", "8".
export function formatAmount(quantity: number, unit: string): string {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return "";
  if (unit === "count") return String(Number(q.toFixed(2)));
  if (unit === "ml") return `${Number(q.toFixed(1))} ml`;
  if (q < 0.15) {
    const dashes = Math.max(1, Math.round(q / 0.03));
    return `${dashes} dash${dashes === 1 ? "" : "es"}`;
  }
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  const quarters: Record<number, string> = { 1: "¼", 2: "½", 3: "¾" };
  const qi = Math.round(frac * 4);
  if (Math.abs(frac * 4 - qi) < 0.02) {
    if (qi === 0) return `${whole} oz`;
    if (qi === 4) return `${whole + 1} oz`;
    return `${whole || ""}${quarters[qi]} oz`;
  }
  return `${Number(q.toFixed(2))} oz`;
}

export interface RecipeCard {
  name: string;
  glass: string | null; // "Rocks glass", or the recipe's own words
  method: string | null; // "Shaken"
  garnish: string | null; // "Salt rim, lime wheel"
  description: string | null;
  instructions: string | null;
  lines: { name: string; amount: string; optional: boolean; family: Family | null }[];
}

export function recipeCard(r: Pick<BookRecipe, "name" | "glassware" | "method" | "garnishes" | "description" | "instructions" | "lines">): RecipeCard {
  const glassKey = normalizeGlass(r.glassware);
  const garnish = r.garnishes.join(", ");
  return {
    name: r.name,
    glass: glassKey && r.glassware && r.glassware.trim().toLowerCase() === glassKey ? GLASS_LABEL[glassKey] : r.glassware?.trim() || null,
    method: r.method ? METHOD_LABEL[r.method] : null,
    garnish: garnish ? garnish.charAt(0).toUpperCase() + garnish.slice(1).toLowerCase() : null,
    description: r.description?.trim() || null,
    instructions: r.instructions?.trim() || null,
    lines: r.lines.map((l) => ({ name: l.name, amount: formatAmount(l.quantity, l.unit), optional: l.optional, family: l.family })),
  };
}

// ---------- the bar display ----------

// What the bar board shows for one menu item: its icon, and its recipe
// card when it has a recipe.
export interface BoardEntry {
  spec: IconSpec;
  card: RecipeCard | null;
}

// A ticket line's entry, or null: coffee, sodas, custom lines and items
// added after the page loaded have none, and draw as they always did.
export function boardEntryFor(map: Readonly<Record<string, BoardEntry>> | null | undefined, menuItemId: string | null | undefined): BoardEntry | null {
  if (!map || typeof menuItemId !== "string" || !menuItemId) return null;
  if (!Object.prototype.hasOwnProperty.call(map, menuItemId)) return null;
  const e = map[menuItemId];
  return e && typeof e === "object" && e.spec ? e : null;
}
