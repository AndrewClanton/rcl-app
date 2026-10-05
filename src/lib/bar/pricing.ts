// What a drink costs to pour and what we'd charge for it (the Bar Book's
// recipe cards). Plain functions, client-safe: no server imports, so the
// register, the back office and scripts/check-bar-book.mjs all use them.
//
// Cost is the sum of each line's amount × its ingredient's unit cost
// (ingredients.unit_cost is per the ingredient's own unit: per oz for oz).
// Optional lines (a garnish, a float) count when they have a cost and are
// skipped when they don't. The suggested price is the cost ÷ the target pour
// cost (a setting, 20% unless an owner changes it), rounded up to a whole
// dollar. Nothing here changes a menu price or any sale math.

import { DOUBLE } from "@/lib/bar/double";

export const DEFAULT_TARGET_POUR_COST = 0.2;
export const TARGET_POUR_COST_SETTING = "bar_target_pour_cost";
// What an owner can set it to.
export const TARGET_MIN = 0.05;
export const TARGET_MAX = 0.6;

export function validTarget(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= TARGET_MIN && n <= TARGET_MAX ? n : null;
}

export interface CostLine {
  name: string;
  quantity: number;
  unitCost: number | null | undefined;
  optional?: boolean;
}

export interface DrinkCost {
  cost: number | null; // null while a required line has no cost
  known: number; // what the lines with a cost add up to (a floor when some are missing)
  missing: string[]; // required ingredients with no cost
  anyCost: boolean; // at least one line has a cost
}

const toCents = (n: number) => Math.round(n * 100 + 1e-9);

export function drinkCost(lines: readonly CostLine[]): DrinkCost {
  let known = 0;
  let anyCost = false;
  const missing: string[] = [];
  for (const l of lines) {
    const q = Number(l.quantity);
    const c = l.unitCost === null || l.unitCost === undefined ? NaN : Number(l.unitCost);
    if (Number.isFinite(c) && c >= 0) {
      anyCost = true;
      if (Number.isFinite(q) && q > 0) known += q * c;
    } else if (!l.optional && !missing.includes(l.name)) {
      missing.push(l.name);
    }
  }
  known = Math.round(known * 10000) / 10000;
  return { cost: missing.length ? null : known, known, missing, anyCost };
}

// Cost ÷ target, up to a whole dollar ($1 at least). Null with no cost.
export function suggestedPrice(cost: number | null, target: number = DEFAULT_TARGET_POUR_COST): number | null {
  const t = validTarget(target) ?? DEFAULT_TARGET_POUR_COST;
  if (cost === null || !Number.isFinite(cost) || cost <= 0) return null;
  // Rounded to a hundredth of a cent first, so $1.60 at 20% is $8, not $9.
  const raw = Math.round((cost / t) * 10000) / 10000;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

export function pourCost(cost: number | null, price: number | null | undefined): number | null {
  if (cost === null || !Number.isFinite(cost) || price === null || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  return cost / price;
}

// The average pour cost of the menu's cocktails whose recipes are fully
// costed. Null when none are.
export function averagePourCost(drinks: readonly { cost: number | null; price: number | null | undefined }[]): number | null {
  const pcts = drinks.map((d) => pourCost(d.cost, d.price)).filter((p): p is number => p !== null);
  if (!pcts.length) return null;
  return pcts.reduce((s, p) => s + p, 0) / pcts.length;
}

// Below what we know it costs, to the cent. With some costs missing the
// known part is a floor, so a price under it is below cost for sure.
export function isBelowCost(price: number, cost: DrinkCost): boolean {
  if (!Number.isFinite(price) || !cost.anyCost) return false;
  return toCents(price) < toCents(cost.known);
}

export const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;

function namesList(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export interface PriceSummary {
  text: string; // the line on the recipe card
  suggested: number | null;
  cost: DrinkCost;
}

// The recipe card's money line:
//   "Cost $1.62 · Suggested $9 · Our cocktails average 19% pour cost; this would be 18%"
// For a drink on the menu it also gives the menu price and its pour cost.
export function priceSummary(args: { cost: DrinkCost; target: number; menuPrice?: number | null; average?: number | null }): PriceSummary {
  const { cost } = args;
  if (!cost.anyCost) return { text: "No bottle costs yet: add them in Back office → Bar Book.", suggested: null, cost };
  if (cost.cost === null) return { text: `Cost unknown: no price for ${namesList(cost.missing)}.`, suggested: null, cost };
  const suggested = suggestedPrice(cost.cost, args.target);
  const parts = [`Cost ${money(cost.cost)}`];
  const menuPct = pourCost(cost.cost, args.menuPrice ?? null);
  if (args.menuPrice !== null && args.menuPrice !== undefined && menuPct !== null) parts.push(`Menu ${money(args.menuPrice)} (${pct(menuPct)} pour cost)`);
  if (suggested === null) return { text: `${parts.join(" · ")} · Set a price by hand.`, suggested, cost };
  parts.push(`Suggested $${suggested}`);
  const would = pourCost(cost.cost, suggested)!;
  const avg = args.average ?? null;
  parts.push(avg !== null ? `Our cocktails average ${pct(avg)} pour cost; this would be ${pct(would)}` : `This would be ${pct(would)} pour cost`);
  return { text: parts.join(" · "), suggested, cost };
}

// Bottle price ÷ bottle size: the per-unit cost the database keeps
// (ingredients.unit_cost). Null for anything that isn't a positive number.
export function unitCostFromBottle(bottlePrice: number, bottleSize: number): number | null {
  if (!Number.isFinite(bottlePrice) || !Number.isFinite(bottleSize) || bottlePrice < 0 || bottleSize <= 0) return null;
  return Math.round((bottlePrice / bottleSize) * 10000) / 10000;
}

// ---------- a Bar Book drink on the order ----------

// The line an off-menu Bar Book drink puts on the order: the same one-off
// line as the register's "+ Custom item" (no menu item, any price), named
// after the drink, always alcohol so the ID check applies, and carrying
// its recipe so the bar tablet and the usage report know what was poured.
export interface BookOrderLine {
  menuItemId: null;
  name: string;
  unit: number;
  qty: 1;
  mods: string[];
  isAlcohol: true;
  recipeId: string;
}

export type PriceCheck = { ok: true; price: number } | { ok: false; error: string };

// What staff typed in the price box, checked like a custom item's price.
export function readPrice(text: string): PriceCheck {
  const t = String(text ?? "").trim().replace(/^\$/, "");
  if (!t) return { ok: false, error: "Type a price." };
  if (!/^\d{0,4}(\.\d{0,2})?$/.test(t) || t === ".") return { ok: false, error: "Type a price like 9 or 9.50." };
  const n = Math.round(Number(t) * 100) / 100;
  if (!(n > 0)) return { ok: false, error: "The price has to be more than $0." };
  if (n >= 10000) return { ok: false, error: "That price is too high." };
  return { ok: true, price: n };
}

// double: rung up as a double ("Double" on the line; the price already has it).
export function bookOrderLine(drink: { recipeId: string; name: string }, price: number, double = false): BookOrderLine {
  return { menuItemId: null, name: drink.name.trim().slice(0, 80) || "Bar Book drink", unit: Math.round(price * 100) / 100, qty: 1, mods: double ? [DOUBLE] : [], isAlcohol: true, recipeId: drink.recipeId };
}

// The recipe an order line may keep (order_items.recipe_id), checked on the
// server against the off-menu recipes it found: only on a one-off line (no
// menu item, not a movie ticket), so a recipe can never ride on a menu
// item's line or a ticket. Anything else is dropped (null).
export function bookRecipeIdOf(
  line: { menu_item_id: string | null; screening_id?: string | null; recipe_id?: string | null },
  known: { has(id: string): boolean },
): string | null {
  if (line.menu_item_id || line.screening_id || typeof line.recipe_id !== "string") return null;
  const id = line.recipe_id.toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) && known.has(id) ? id : null;
}
