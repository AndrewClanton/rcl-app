// A double (Andrew, Oct 2026: "every alcoholic drink needs an automatic
// double"), and a Liquor shot poured neat or on the rocks. Plain functions,
// client-safe: the register, the server's sale check and
// scripts/check-bar-book.mjs all use these, so they agree.
//
// What a double is, the US bar standard: twice the spirit. A 1.5 oz pour
// becomes 3 oz; in a mixed drink only the spirit doubles, the mixers,
// juice and garnish stay as they are. It's for spirit drinks (shots, neat
// or rocks pours, cocktails), never beer (it has sizes) or wine (a "double
// pour" isn't a thing).
//
// How it's priced (Back office → Bar Book → Prices; these are the
// defaults): the second pour at $1 off the shot price for its level, per
// 1.5 oz. Well is a $5 shot, call $7, premium $9, so 1.5 oz of well is +$4,
// call +$6, premium +$8.
//   - a shot: its level's second pour, so a $5 well shot is $9 (+$4). The
//     level comes from the item's name ("Call shot").
//   - neat or on the rocks: the same on its 2 oz (well: 2 × $4 ÷ 1.5 =
//     $5.33, so +$5.50)
//   - a drink with a recipe: each base-spirit line's ounces × (its level's
//     shot price − $1) ÷ 1.5, rounded to the nearest $0.50. No spirit lines
//     (Butter beer's schnapps)? Its liqueurs.
//   - a spirit drink with no recipe: +$4
//
// Neat or on the rocks is for the Well, Call and Premium shots (the shots
// with a "Liquor" choice): a 2 oz pour at the shot price + $2.
//
// On the order each is a line option ("Double", "Neat", "On the rocks")
// plus its upcharge in the line's price, so tickets, receipts, tabs and the
// daily email carry it with nothing new in the database. Never when the
// item already has its own option of that name (an espresso's "Double").
import { isKind, kindFor } from "@/lib/bar/icons";
import type { BarSection } from "@/lib/bar/icons";

export const DOUBLE = "Double";
export const NEAT = "Neat";
export const ROCKS = "On the rocks";

export type Tier = "well" | "call" | "premium";
export type Serve = "neat" | "rocks";
export const SERVE_MOD: Record<Serve, string> = { neat: NEAT, rocks: ROCKS };

// What these are priced from. The Prices sheet works them out from its
// knobs (lib/bar/pricing.ts, doubleSettingsOf).
export interface DoubleSettings {
  pourDiscount: number; // taken off the level's shot price for the second pour
  tiers: Record<Tier, number>; // a shot at each level
  noRecipeUpcharge: number; // a spirit drink we have no recipe for
  rounding: number; // a double's upcharge to the nearest this
  standardOz: number; // a standard pour: what one shot price buys
  neatOz: number; // a neat or rocks pour
  serveUpcharge: number; // neat or rocks on a shot
}

export const DOUBLE_DEFAULTS: DoubleSettings = { pourDiscount: 1, tiers: { well: 5, call: 7, premium: 9 }, noRecipeUpcharge: 4, rounding: 0.5, standardOz: 1.5, neatOz: 2, serveUpcharge: 2 };

// An ingredient's tier, from its name: "Call Vodka" is call, "Premium
// Tequila" premium, anything else (Well Vodka, Tito's) well.
export function tierOf(name: string): Tier {
  if (/\bpremium\b/i.test(name)) return "premium";
  if (/\bcall\b/i.test(name)) return "call";
  return "well";
}

export const TIER_RANK: Record<Tier, number> = { well: 0, call: 1, premium: 2 };

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

// A line's amount in ounces (ml converted; a count is no pour).
export const ouncesOf = (l: DoubleLine) => {
  const q = Number(l.quantity);
  if (!Number.isFinite(q) || q <= 0 || l.unit === "count") return 0;
  return l.unit === "ml" ? q / 29.5735 : q;
};

export function roundTo(n: number, step: number): number {
  if (!(step > 0)) return Math.round(n * 100) / 100;
  return Math.round(Math.round((n / step) * 1e6) / 1e6) * step;
}

const toCents = (n: number) => Math.round(n * 100) / 100;

// The second pour of `oz` at a level: oz × (its shot price − the discount)
// ÷ a standard pour, before rounding.
const perPour = (oz: number, tier: Tier, s: DoubleSettings) => (oz * Math.max(0, s.tiers[tier] - s.pourDiscount)) / (s.standardOz > 0 ? s.standardOz : 1.5);

// A double of a straight pour (a shot, or a neat or rocks pour) at a level.
export function pourUpcharge(oz: number, tier: Tier, s: DoubleSettings = DOUBLE_DEFAULTS): number {
  return toCents(roundTo(perPour(oz, tier, s), s.rounding));
}

// A recipe's upcharge: each base line's ounces × (its level's shot price −
// the discount) ÷ a standard pour, rounded. Null when it has nothing to
// double.
export function recipeUpcharge(lines: readonly DoubleLine[], s: DoubleSettings = DOUBLE_DEFAULTS): number | null {
  const base = baseLines(lines).filter((l) => ouncesOf(l) > 0);
  if (!base.length) return null;
  const raw = base.reduce((sum, l) => sum + perPour(ouncesOf(l), tierOf(l.name), s), 0);
  return toCents(roundTo(raw, s.rounding));
}

export interface DoubleContext {
  isAlcohol: boolean;
  section: BarSection | null; // where it sits on the Bar tab; null outside it
  ownDouble: boolean; // the item has its own option called "Double"
  recipe: readonly DoubleLine[] | null; // its recipe, if it has one
  name?: string | null; // the menu item's name: a shot's level ("Call shot")
  liquor?: boolean; // the item has a "Liquor" choice (the Well, Call and Premium shots)
  ownServe?: boolean; // the item has its own "Neat" or "On the rocks" option
  serve?: Serve | null; // poured neat or on the rocks
}

// What doubling adds to the single, or null when it can't be a double.
// A shot's double is priced on its pour (2 oz neat or rocks), not its price.
export function doubleUpcharge(ctx: DoubleContext, s: DoubleSettings = DOUBLE_DEFAULTS): number | null {
  if (!ctx.isAlcohol || ctx.ownDouble) return null;
  if (ctx.section === "beer" || ctx.section === "wine") return null;
  if (ctx.section === "shots") return pourUpcharge(ctx.serve && canServe(ctx) ? s.neatOz : s.standardOz, tierOf(ctx.name ?? ""), s);
  if (ctx.recipe && ctx.recipe.length) return recipeUpcharge(ctx.recipe, s);
  // No recipe: a spirit drink on the Bar tab, at the flat upcharge. Outside
  // the bar we can't tell a spirit drink from anything else.
  return ctx.section ? s.noRecipeUpcharge : null;
}

// The single's price back from a double's (taking the Double off a line).
export function undoDouble(unit: number, ctx: DoubleContext, s: DoubleSettings = DOUBLE_DEFAULTS): number {
  return toCents(unit - (doubleUpcharge(ctx, s) ?? 0));
}

export const isDouble = (mods: readonly string[] | null | undefined) => Array.isArray(mods) && mods.some((m) => m === DOUBLE);
export const isServeMod = (m: string) => m === NEAT || m === ROCKS;

// Neat or on the rocks, from a line's options (never an item's own option
// of that name).
export function serveOf(mods: readonly string[] | null | undefined, ownServe = false): Serve | null {
  if (ownServe || !Array.isArray(mods)) return null;
  if (mods.includes(NEAT)) return "neat";
  if (mods.includes(ROCKS)) return "rocks";
  return null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.toLowerCase();

// An item's own option called "Double" (an espresso's): then "Double" on
// its line is that option, priced as the menu says, and never our double.
export function hasOwnDouble(groups: readonly { options: readonly { name: string }[] }[] | null | undefined): boolean {
  return (groups ?? []).some((g) => g.options.some((o) => sameName(o.name, DOUBLE)));
}

// The same guard for neat and on the rocks.
export function hasOwnServe(groups: readonly { options: readonly { name: string }[] }[] | null | undefined): boolean {
  return (groups ?? []).some((g) => g.options.some((o) => sameName(o.name, NEAT) || sameName(o.name, ROCKS)));
}

// The Well, Call and Premium shots carry a "Liquor" choice (vodka, rum…).
export function hasLiquorChoice(groups: readonly { key?: string | null; label?: string | null }[] | null | undefined): boolean {
  return (groups ?? []).some((g) => sameName(g.key ?? "", "liquor") || sameName(g.label ?? "", "liquor"));
}

// Neat or on the rocks: only a Liquor shot, and never over its own option.
export function canServe(ctx: DoubleContext): boolean {
  return ctx.isAlcohol && ctx.section === "shots" && !!ctx.liquor && !ctx.ownServe;
}

// What our options add to the single's price: neat or rocks, then a double
// of that pour. Null when the line can't have them.
export function optionsUpcharge(ctx: DoubleContext, opts: { serve: Serve | null; double: boolean }, s: DoubleSettings = DOUBLE_DEFAULTS): number | null {
  let up = 0;
  if (opts.serve) {
    if (!canServe(ctx)) return null;
    up += s.serveUpcharge;
  }
  if (opts.double) {
    const d = doubleUpcharge({ ...ctx, serve: opts.serve }, s);
    if (d === null) return null;
    up += d;
  }
  return toCents(up);
}

// A menu line's price as the server checks it: `unit` is the single's
// price from the menu and its other options; our options on a line that
// can have them add their upcharges, and on one that can't are an error
// (finishing "<the line's name> …").
export function priceWithOptions(unit: number, mods: readonly string[], ctx: DoubleContext, s: DoubleSettings = DOUBLE_DEFAULTS): { unit: number } | { error: string } {
  const serves = ctx.ownServe ? [] : mods.filter(isServeMod);
  const double = !ctx.ownDouble && isDouble(mods);
  if (new Set(serves).size > 1) return { error: "was rung both neat and on the rocks" };
  const serve = serveOf(serves);
  if (!serve && !double) return { unit };
  if (serve && !canServe(ctx)) return { error: "was rung neat or on the rocks, but only a Liquor shot can be" };
  const up = optionsUpcharge(ctx, { serve, double }, s);
  if (up === null) return { error: "was rung as a double, but it can't be one (beer, wine, or no spirit in it)" };
  return { unit: toCents(unit + up) };
}

// The options a menu line's other options are priced from: everything but
// ours (unless the item has its own of that name).
export function withoutOurs(mods: readonly string[], ownDouble: boolean, ownServe: boolean): string[] {
  return mods.filter((m) => !((m === DOUBLE && !ownDouble) || (isServeMod(m) && !ownServe)));
}

// A recipe with its base lines doubled, for a card that shows a double
// (the amounts and the cost both).
export function doubledLines<L extends DoubleLine>(lines: readonly L[]): L[] {
  const base = new Set(baseLines(lines));
  return lines.map((l) => (base.has(l) ? { ...l, quantity: Number(l.quantity) * 2 } : l));
}

// What a line pours, for Bar usage: its base lines poured at `pourOz` in
// all (neat or rocks: 2 oz), and twice that for a double.
export function pouredLines<L extends DoubleLine>(lines: readonly L[], opts: { double?: boolean; pourOz?: number | null }): L[] {
  const base = new Set(baseLines(lines));
  const baseOz = [...base].reduce((sum, l) => sum + ouncesOf(l), 0);
  const scale = opts.pourOz && opts.pourOz > 0 && baseOz > 0 ? opts.pourOz / baseOz : 1;
  const times = opts.double ? 2 : 1;
  if (scale === 1 && times === 1) return [...lines];
  return lines.map((l) => (base.has(l) ? { ...l, quantity: Math.round(Number(l.quantity) * scale * times * 10000) / 10000 } : l));
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
