// A double (Andrew, Oct 2026: "every alcoholic drink needs an automatic
// double"). Plain functions, client-safe: the register, the server's sale
// check and scripts/check-bar-book.mjs all use these, so they agree.
//
// What a double is, the US bar standard: twice the spirit. A 1.5 oz pour
// becomes 3 oz; in a mixed drink only the spirit doubles, the mixers,
// juice and garnish stay as they are. It's for spirit drinks (shots, neat
// or rocks pours, cocktails), never beer (it has sizes) or wine (a "double
// pour" isn't a thing).
//
// How it's priced (every number is a setting, these are the defaults):
//   - a shot: twice the single, so a $5 well shot is $10 (+$5)
//   - a drink with a recipe: each base-spirit line's ounces × (its tier's
//     shot price − $1) ÷ 1.5, rounded to the nearest $0.50. Well is a $5
//     shot, call $7, premium $9, so 1.5 oz of well is +$4, call +$6,
//     premium +$8. No spirit lines (Butter beer's schnapps)? Its liqueurs.
//   - a spirit drink with no recipe: +$4
//
// On the order a double is the line's "Double" option plus the upcharge in
// its price, so tickets, receipts, tabs and the daily email carry it with
// nothing new in the database. Only on an alcohol line that can be one, and
// never when the item already has its own "Double" option (an espresso).
import { isKind, kindFor } from "@/lib/bar/icons";
import type { BarSection } from "@/lib/bar/icons";

export const DOUBLE = "Double";

export type Tier = "well" | "call" | "premium";

export interface DoubleSettings {
  shotMultiplier: number; // a double shot is this many singles
  pourDiscount: number; // taken off the shot price per 1.5 oz in a cocktail
  tiers: Record<Tier, number>; // a 1.5 oz shot at each tier
  noRecipeUpcharge: number; // a spirit drink we have no recipe for
  rounding: number; // a cocktail's upcharge to the nearest this
}

export const DOUBLE_DEFAULTS: DoubleSettings = { shotMultiplier: 2, pourDiscount: 1, tiers: { well: 5, call: 7, premium: 9 }, noRecipeUpcharge: 4, rounding: 0.5 };
export const DOUBLE_SETTING = "bar_double";

const within = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// The stored setting (settings.bar_double), each knob checked on its own:
// anything missing or out of range is the default.
export function readDoubleSettings(v: unknown): DoubleSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const t = o.tiers && typeof o.tiers === "object" ? (o.tiers as Record<string, unknown>) : {};
  return {
    shotMultiplier: within(o.shotMultiplier, 1, 4) ?? DOUBLE_DEFAULTS.shotMultiplier,
    pourDiscount: within(o.pourDiscount, 0, 20) ?? DOUBLE_DEFAULTS.pourDiscount,
    tiers: {
      well: within(t.well, 0, 100) ?? DOUBLE_DEFAULTS.tiers.well,
      call: within(t.call, 0, 100) ?? DOUBLE_DEFAULTS.tiers.call,
      premium: within(t.premium, 0, 100) ?? DOUBLE_DEFAULTS.tiers.premium,
    },
    noRecipeUpcharge: within(o.noRecipeUpcharge, 0, 100) ?? DOUBLE_DEFAULTS.noRecipeUpcharge,
    rounding: within(o.rounding, 0.01, 5) ?? DOUBLE_DEFAULTS.rounding,
  };
}

// An ingredient's tier, from its name: "Call Vodka" is call, "Premium
// Tequila" premium, anything else (Well Vodka, Tito's) well.
export function tierOf(name: string): Tier {
  if (/\bpremium\b/i.test(name)) return "premium";
  if (/\bcall\b/i.test(name)) return "call";
  return "well";
}

export interface DoubleLine {
  name: string;
  quantity: number;
  unit?: string | null;
  kind?: string | null;
  optional?: boolean;
}

const kindIn = (l: DoubleLine) => (isKind(l.kind) ? l.kind : kindFor(l.name));

// The lines a double doubles: the spirits, else (no spirit at all) the
// liqueurs. Optional lines aren't part of the pour.
export function baseLines<L extends DoubleLine>(lines: readonly L[]): L[] {
  const required = lines.filter((l) => !l.optional);
  const spirits = required.filter((l) => kindIn(l) === "spirit");
  return spirits.length ? spirits : required.filter((l) => kindIn(l) === "liqueur");
}

const ounces = (l: DoubleLine) => {
  const q = Number(l.quantity);
  if (!Number.isFinite(q) || q <= 0 || l.unit === "count") return 0;
  return l.unit === "ml" ? q / 29.5735 : q;
};

export function roundTo(n: number, step: number): number {
  if (!(step > 0)) return Math.round(n * 100) / 100;
  return Math.round(Math.round((n / step) * 1e6) / 1e6) * step;
}

const toCents = (n: number) => Math.round(n * 100) / 100;

// A recipe's upcharge: each base line's ounces × (tier price − discount)
// ÷ 1.5, rounded. Null when it has nothing to double.
export function recipeUpcharge(lines: readonly DoubleLine[], s: DoubleSettings = DOUBLE_DEFAULTS): number | null {
  const base = baseLines(lines).filter((l) => ounces(l) > 0);
  if (!base.length) return null;
  const raw = base.reduce((sum, l) => sum + (ounces(l) * Math.max(0, s.tiers[tierOf(l.name)] - s.pourDiscount)) / 1.5, 0);
  return toCents(roundTo(raw, s.rounding));
}

export interface DoubleContext {
  isAlcohol: boolean;
  section: BarSection | null; // where it sits on the Bar tab; null outside it
  ownDouble: boolean; // the item has its own option called "Double"
  recipe: readonly DoubleLine[] | null; // its recipe, if it has one
}

// What doubling costs on top of `unit` (the single's price, its options
// included), or null when it can't be a double.
export function doubleUpcharge(unit: number, ctx: DoubleContext, s: DoubleSettings = DOUBLE_DEFAULTS): number | null {
  if (!ctx.isAlcohol || ctx.ownDouble) return null;
  if (ctx.section === "beer" || ctx.section === "wine") return null;
  if (ctx.section === "shots") return Number.isFinite(unit) && unit > 0 ? toCents(unit * (s.shotMultiplier - 1)) : null;
  if (ctx.recipe && ctx.recipe.length) return recipeUpcharge(ctx.recipe, s);
  // No recipe: a spirit drink on the Bar tab, at the flat upcharge. Outside
  // the bar we can't tell a spirit drink from anything else.
  return ctx.section ? s.noRecipeUpcharge : null;
}

// The single's price back from a double's (taking the Double off a line).
export function undoDouble(unit: number, ctx: DoubleContext, s: DoubleSettings = DOUBLE_DEFAULTS): number {
  if (ctx.section === "shots") return toCents(unit / Math.max(1, s.shotMultiplier));
  const up = doubleUpcharge(unit, ctx, s) ?? 0;
  return toCents(unit - up);
}

export const isDouble = (mods: readonly string[] | null | undefined) => Array.isArray(mods) && mods.some((m) => m === DOUBLE);

// An item's own option called "Double" (an espresso's): then "Double" on
// its line is that option, priced as the menu says, and never our double.
export function hasOwnDouble(groups: readonly { options: readonly { name: string }[] }[] | null | undefined): boolean {
  return (groups ?? []).some((g) => g.options.some((o) => o.name.trim().toLowerCase() === DOUBLE.toLowerCase()));
}

// A menu line's price as the server checks it: `unit` is the single's
// price from the menu and its other options; a "Double" on a line that can
// be one adds the upcharge, and on one that can't is an error.
export function priceWithDouble(unit: number, mods: readonly string[], ctx: DoubleContext, s: DoubleSettings = DOUBLE_DEFAULTS): { unit: number } | { error: string } {
  if (ctx.ownDouble || !isDouble(mods)) return { unit };
  const up = doubleUpcharge(unit, ctx, s);
  if (up === null) return { error: "it can't be a double (beer, wine, or no spirit in it)" };
  return { unit: toCents(unit + up) };
}

// The options a menu line's other options are priced from: everything but
// our Double (unless the item has its own).
export function withoutDouble(mods: readonly string[], ownDouble: boolean): string[] {
  return ownDouble ? [...mods] : mods.filter((m) => m !== DOUBLE);
}

// A recipe with its base lines doubled, for a card that shows a double
// (the amounts and the cost both).
export function doubledLines<L extends DoubleLine>(lines: readonly L[]): L[] {
  const base = new Set(baseLines(lines));
  return lines.map((l) => (base.has(l) ? { ...l, quantity: Number(l.quantity) * 2 } : l));
}

// Where a menu item sits on the Bar tab, from its category: a section of
// the bar's category (beer, wine, cocktails, shots, other), the bar's own
// items ("other"), or null outside the bar.
export function sectionOfCategory(
  categoryId: string,
  categories: readonly { id: string; key?: string | null; label?: string | null; parent_id: string | null }[],
  isBar: (c: { key?: string | null; label?: string | null }) => boolean,
  sectionOf: (c: { key?: string | null; label?: string | null }) => BarSection,
): BarSection | null {
  const c = categories.find((x) => x.id === categoryId);
  if (!c) return null;
  if (!c.parent_id) return isBar(c) ? "other" : null;
  const parent = categories.find((x) => x.id === c.parent_id);
  return parent && isBar(parent) ? sectionOf(c) : null;
}

export const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
// "+$4", "+$5.50"
export const plus = (n: number) => `+$${Number.isInteger(Math.round(n * 100) / 100) ? String(Math.round(n)) : (Math.round(n * 100) / 100).toFixed(2)}`;
