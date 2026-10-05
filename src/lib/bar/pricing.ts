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
//
// The Prices sheet (Back office → Bar Book → Prices) and the Royale rule
// that prices an off-menu or custom drink from it are at the bottom.

import { DOUBLE, TIER_RANK, baseLines, ouncesOf, pourUpcharge, recipeUpcharge, tierOf, type DoubleSettings, type Tier } from "@/lib/bar/double";
import { familyFor, isFamily, isKind, kindFor, type Family, type Kind } from "@/lib/bar/icons";

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

// ---------- the Prices sheet ----------
//
// Every bar price knob in one place (Back office → Bar Book → Prices):
// settings.bar_prices, with the target pour cost in its own
// settings.bar_target_pour_cost. Until someone saves the sheet, these
// defaults apply; each knob that's missing or out of range is its default.
//
// The Royale rule: price = serve + level + double + mixer.
//   - serve, at well level: a shot (1.5 oz) $5, a highball (1.5 oz spirit
//     and a mixer) $8, neat or on the rocks (2 oz) $7, a cocktail (up to
//     2.5 oz of spirit) $10
//   - level: well +$0, call +$2, premium +$4 (from the bottle's name, as a
//     double does it: "Call Vodka")
//   - double: the second pour at $1 off the level's shot price (+$4/+6/+8)
//   - mixer: soda-gun mixers, house juices and cream are included; ginger
//     beer +$1, an energy drink +$2
// Menu drinks keep their menu price. The rule prices what isn't on the
// menu: an off-menu Bar Book drink and a "What's in it?" custom drink.

export const BAR_PRICES_SETTING = "bar_prices";

export type ServeType = "shot" | "highball" | "neat" | "cocktail";
export const SERVE_TYPES: readonly ServeType[] = ["shot", "highball", "neat", "cocktail"];
export const SERVE_LABEL: Record<ServeType, string> = { shot: "Shot", highball: "Highball", neat: "Neat or rocks", cocktail: "Cocktail" };
const SERVE_WORD: Record<ServeType, string> = { shot: "shot", highball: "highball", neat: "neat or rocks", cocktail: "cocktail" };
export const TIERS: readonly Tier[] = ["well", "call", "premium"];

// The mixer rules. An ingredient is priced by the first rule that names
// it (its name contains one of the rule's names), else by the rule that
// covers its kind or color family.
export type MixerKey = "gingerBeer" | "energy" | "included";
export const MIXER_KEYS: readonly MixerKey[] = ["gingerBeer", "energy", "included"];
export const MIXER_RULES: Record<MixerKey, { label: string; kinds: readonly Kind[]; families: readonly Family[] }> = {
  gingerBeer: { label: "Ginger beer", kinds: [], families: [] },
  energy: { label: "Energy drink", kinds: [], families: [] },
  included: { label: "Soda-gun mixers, house juices and cream", kinds: ["mixer", "juice"], families: ["cream"] },
};

export interface BarPrices {
  serve: Record<ServeType, number>; // at well level
  level: Record<Tier, number>; // on top of the serve
  mixers: Record<MixerKey, { price: number; names: string[] }>;
  double: { pourDiscount: number; noRecipe: number; rounding: number };
  pours: { standard: number; neat: number; double: number; wine: number; cocktailMax: number }; // oz
  target: number; // the target pour cost (settings.bar_target_pour_cost)
}

export const BAR_PRICES_DEFAULTS: BarPrices = {
  serve: { shot: 5, highball: 8, neat: 7, cocktail: 10 },
  level: { well: 0, call: 2, premium: 4 },
  mixers: {
    gingerBeer: { price: 1, names: ["ginger beer"] },
    energy: { price: 2, names: ["energy drink", "red bull", "monster"] },
    included: { price: 0, names: [] },
  },
  double: { pourDiscount: 1, noRecipe: 4, rounding: 0.5 },
  pours: { standard: 1.5, neat: 2, double: 3, wine: 5, cocktailMax: 2.5 },
  target: DEFAULT_TARGET_POUR_COST,
};

// What each knob may be.
export const KNOB_RANGE = {
  serve: [0, 100],
  level: [0, 100],
  mixer: [0, 20],
  pourDiscount: [0, 20],
  noRecipe: [0, 100],
  rounding: [0.01, 5],
  standard: [0.25, 4],
  neat: [0.25, 6],
  double: [0.5, 8],
  wine: [1, 12],
  cocktailMax: [0.5, 8],
} as const;

const within = (v: unknown, [lo, hi]: readonly [number, number]): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const squashName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const toDollars = (n: number) => Math.round(n * 100) / 100;

// A mixer rule's names: up to 12, each 1 to 40 characters, lower case.
// Null when it isn't a list of names.
export function readNames(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 12) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return null;
    const n = squashName(x);
    if (!n || n.length > 40) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// The stored sheet (settings.bar_prices) and target, each knob checked on
// its own: anything missing or out of range is the default.
export function readBarPrices(stored: unknown, target?: unknown): BarPrices {
  const o = obj(stored);
  const D = BAR_PRICES_DEFAULTS;
  const R = KNOB_RANGE;
  const sv = obj(o.serve);
  const lv = obj(o.level);
  const mx = obj(o.mixers);
  const db = obj(o.double);
  const ps = obj(o.pours);
  const mixer = (k: MixerKey) => ({ price: within(obj(mx[k]).price, R.mixer) ?? D.mixers[k].price, names: readNames(obj(mx[k]).names) ?? D.mixers[k].names });
  return {
    serve: {
      shot: within(sv.shot, R.serve) ?? D.serve.shot,
      highball: within(sv.highball, R.serve) ?? D.serve.highball,
      neat: within(sv.neat, R.serve) ?? D.serve.neat,
      cocktail: within(sv.cocktail, R.serve) ?? D.serve.cocktail,
    },
    level: { well: within(lv.well, R.level) ?? D.level.well, call: within(lv.call, R.level) ?? D.level.call, premium: within(lv.premium, R.level) ?? D.level.premium },
    mixers: { gingerBeer: mixer("gingerBeer"), energy: mixer("energy"), included: mixer("included") },
    double: {
      pourDiscount: within(db.pourDiscount, R.pourDiscount) ?? D.double.pourDiscount,
      noRecipe: within(db.noRecipe, R.noRecipe) ?? D.double.noRecipe,
      rounding: within(db.rounding, R.rounding) ?? D.double.rounding,
    },
    pours: {
      standard: within(ps.standard, R.standard) ?? D.pours.standard,
      neat: within(ps.neat, R.neat) ?? D.pours.neat,
      double: within(ps.double, R.double) ?? D.pours.double,
      wine: within(ps.wine, R.wine) ?? D.pours.wine,
      cocktailMax: within(ps.cocktailMax, R.cocktailMax) ?? D.pours.cocktailMax,
    },
    target: validTarget(target) ?? DEFAULT_TARGET_POUR_COST,
  };
}

// The sheet as an owner sends it, checked strictly (the server's save):
// every knob a number in its range, every name list a list of names.
export function checkBarPrices(input: unknown): { ok: true; prices: BarPrices } | { ok: false; error: string } {
  const i = obj(input);
  const p = readBarPrices(input, i.target);
  const same = (a: unknown, b: number) => typeof a === "number" && Math.abs(a - b) < 1e-9;
  const bad: string[] = [];
  for (const k of SERVE_TYPES) if (!same(obj(i.serve)[k], p.serve[k])) bad.push(`the ${SERVE_WORD[k]} price`);
  for (const t of TIERS) if (!same(obj(i.level)[t], p.level[t])) bad.push(`the ${t} upcharge`);
  for (const k of MIXER_KEYS) {
    const m = obj(obj(i.mixers)[k]);
    if (!same(m.price, p.mixers[k].price)) bad.push(`the ${MIXER_RULES[k].label.toLowerCase()} price`);
    if (readNames(m.names) === null) bad.push(`the ${MIXER_RULES[k].label.toLowerCase()} names`);
  }
  const d = obj(i.double);
  if (!same(d.pourDiscount, p.double.pourDiscount) || !same(d.noRecipe, p.double.noRecipe) || !same(d.rounding, p.double.rounding)) bad.push("the double");
  const ps = obj(i.pours);
  if (!same(ps.standard, p.pours.standard) || !same(ps.neat, p.pours.neat) || !same(ps.double, p.pours.double) || !same(ps.wine, p.pours.wine) || !same(ps.cocktailMax, p.pours.cocktailMax)) {
    bad.push("the pour standard");
  }
  if (!same(i.target, p.target)) bad.push("the target pour cost (5% to 60%)");
  if (bad.length) return { ok: false, error: `Check ${namesList(bad, 4)}: ${bad.length === 1 ? "it isn't a number" : "they aren't numbers"} the register can use.` };
  return { ok: true, prices: p };
}

// What a double and neat or rocks are priced from (lib/bar/double.ts).
export function doubleSettingsOf(p: BarPrices): DoubleSettings {
  return {
    pourDiscount: p.double.pourDiscount,
    tiers: { well: p.serve.shot + p.level.well, call: p.serve.shot + p.level.call, premium: p.serve.shot + p.level.premium },
    noRecipeUpcharge: p.double.noRecipe,
    rounding: p.double.rounding,
    standardOz: p.pours.standard,
    neatOz: p.pours.neat,
    serveUpcharge: Math.max(0, p.serve.neat - p.serve.shot),
  };
}

// The shot at each level: single, double, neat or rocks, and both.
export function shotPrices(p: BarPrices): Record<Tier, { single: number; double: number; neat: number; neatDouble: number }> {
  const s = doubleSettingsOf(p);
  const row = (t: Tier) => {
    const single = s.tiers[t];
    const neat = single + s.serveUpcharge;
    return { single, double: toDollars(single + pourUpcharge(s.standardOz, t, s)), neat, neatDouble: toDollars(neat + pourUpcharge(s.neatOz, t, s)) };
  };
  return { well: row("well"), call: row("call"), premium: row("premium") };
}

export interface RuleLine {
  name: string;
  quantity: number;
  unit?: string | null;
  kind?: string | null;
  family?: string | null;
  optional?: boolean;
}

const kindOfLine = (l: RuleLine): Kind => (isKind(l.kind) ? l.kind : kindFor(l.name));
const familyOfLine = (l: RuleLine): Family | null => (isFamily(l.family) ? l.family : familyFor(l.name, { kind: l.kind }));

// Which mixer rule prices an ingredient, or null for none.
export function mixerRuleFor(line: RuleLine, p: BarPrices = BAR_PRICES_DEFAULTS): MixerKey | null {
  const n = squashName(line.name);
  for (const k of MIXER_KEYS) if (p.mixers[k].names.some((x) => n.includes(x))) return k;
  const kind = kindOfLine(line);
  const fam = familyOfLine(line);
  for (const k of MIXER_KEYS) if (MIXER_RULES[k].kinds.includes(kind) || (fam !== null && MIXER_RULES[k].families.includes(fam))) return k;
  return null;
}

export interface RulePrice {
  serve: ServeType;
  tier: Tier;
  label: string; // "call highball"
  parts: { label: string; amount: number }[]; // what it adds up to
  base: number; // serve + level + mixers, up to a whole dollar
  double: number | null; // what the double adds, when asked for (null: nothing to double)
  price: number; // base + double
}

// The Royale rule for a drink's lines (an off-menu Bar Book drink or a
// custom drink): price = serve + level + double + mixer.
//   - serve: one spirit and nothing else is a shot (neat or rocks at 2 oz
//     and up); one spirit with only mixers and juices (no liqueur) is a
//     highball; anything else is a cocktail. Garnishes and optional lines
//     don't count. A drink with no spirit goes by its liqueur, as a double
//     does.
//   - level: the highest among its spirits (from the name: "Call Vodka").
//   - mixers: each other line's mixer rule.
// Serve + level + mixers rounds up to a whole dollar; a double adds its own
// upcharge (rounded to $0.50). Null with no spirit or liqueur in it (wine
// and beer drinks wait for their own prices).
export function ruleprice(lines: readonly RuleLine[], p: BarPrices = BAR_PRICES_DEFAULTS, opts: { double?: boolean } = {}): RulePrice | null {
  const present = lines.filter((l) => !l.optional && Number(l.quantity) > 0 && kindOfLine(l) !== "garnish");
  const base = baseLines(present);
  if (!base.length) return null;
  const rest = present.filter((l) => !base.includes(l));
  let serve: ServeType;
  if (base.length === 1 && !rest.length) serve = ouncesOf(base[0]) >= p.pours.neat - 1e-9 ? "neat" : "shot";
  else if (base.length === 1 && rest.every((l) => kindOfLine(l) === "mixer" || kindOfLine(l) === "juice")) serve = "highball";
  else serve = "cocktail";
  const tier = base.map((l) => tierOf(l.name)).reduce<Tier>((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a), "well");
  const parts = [{ label: SERVE_LABEL[serve], amount: p.serve[serve] }];
  if (p.level[tier] > 0) parts.push({ label: tier, amount: p.level[tier] });
  for (const l of rest) {
    const k = mixerRuleFor(l, p);
    if (k && p.mixers[k].price > 0) parts.push({ label: l.name.toLowerCase(), amount: p.mixers[k].price });
  }
  const sum = parts.reduce((s, x) => s + x.amount, 0);
  const whole = Math.max(0, Math.ceil(toDollars(sum) - 1e-9));
  const double = opts.double ? recipeUpcharge(present, doubleSettingsOf(p)) : null;
  if (double !== null) parts.push({ label: "double", amount: double });
  return { serve, tier, label: `${tier} ${SERVE_WORD[serve]}`, parts, base: whole, double, price: toDollars(whole + (double ?? 0)) };
}

// "$10", "$10.50"
export const dollars = (n: number) => (Number.isInteger(toDollars(n)) ? `$${Math.round(n)}` : money(n));

export interface ManagersCheck {
  text: string; // "Rule price $10 · Cost $1.62 · 16% pour cost"
  flag: string | null; // "Over 20%: cost suggests $12"
}

// The cost-based suggestion as the manager's check on a rule price: what
// the drink costs, its pour cost at the rule price, and a gentle flag when
// that's over the target. Staff can still change the price.
export function managersCheck(rule: number, cost: DrinkCost, target: number = DEFAULT_TARGET_POUR_COST): ManagersCheck {
  const t = validTarget(target) ?? DEFAULT_TARGET_POUR_COST;
  const head = `Rule price ${dollars(rule)}`;
  if (!cost.anyCost) return { text: `${head} · No bottle costs yet`, flag: null };
  // Over the target to the cent: $2.00 on a $10 rule price is 20%, not over.
  const over = (c: number) => toCents(c) > toCents(rule * t);
  if (cost.cost === null) {
    return {
      text: `${head} · Cost unknown: no price for ${namesList(cost.missing)}`,
      flag: over(cost.known) ? `Over ${pct(t)}: cost suggests at least $${suggestedPrice(cost.known, t)}` : null,
    };
  }
  const pc = pourCost(cost.cost, rule);
  return {
    text: `${head} · Cost ${money(cost.cost)}${pc !== null ? ` · ${pct(pc)} pour cost` : ""}`,
    flag: over(cost.cost) ? `Over ${pct(t)}: cost suggests $${suggestedPrice(cost.cost, t)}` : null,
  };
}

export interface OffMenuPricing {
  price: number | null; // what the price box starts at
  text: string; // the card's money line
  flag: string | null; // the manager's check's flag
  rule: RulePrice | null;
}

// An off-menu Bar Book drink's or a custom drink's price: the rule price
// with the manager's check, or (no spirit or liqueur in it) the cost-based
// suggestion as before.
export function offMenuPricing(lines: readonly RuleLine[], cost: DrinkCost, p: BarPrices = BAR_PRICES_DEFAULTS, opts: { double?: boolean } = {}): OffMenuPricing {
  const rule = ruleprice(lines, p, opts);
  if (rule) {
    const check = managersCheck(rule.price, cost, p.target);
    return { price: rule.price, text: check.text, flag: check.flag, rule };
  }
  const s = priceSummary({ cost, target: p.target });
  return { price: s.suggested, text: s.text, flag: null, rule: null };
}

// The review's worked examples, priced live from the sheet (each spirit at
// the standard pour).
export function ruleExamples(p: BarPrices): { name: string; rule: RulePrice | null }[] {
  const oz = p.pours.standard;
  const ex: { name: string; double?: boolean; lines: RuleLine[] }[] = [
    { name: "Tito's soda", lines: [{ name: "Call vodka (Tito's)", quantity: oz, kind: "spirit", family: "vodka" }, { name: "Soda water", quantity: 4, kind: "mixer", family: "soda" }] },
    { name: "Patrón margarita", lines: [{ name: "Premium tequila (Patrón)", quantity: oz, kind: "spirit", family: "tequila" }, { name: "Margarita mix", quantity: 4, kind: "mixer", family: "citrus" }] },
    { name: "Double Jack & Coke", double: true, lines: [{ name: "Call whiskey (Jack Daniel's)", quantity: oz, kind: "spirit", family: "whiskey" }, { name: "Cola", quantity: 4, kind: "mixer", family: "cola" }] },
    {
      name: "Lemon Drop with house vodka",
      lines: [
        { name: "Well vodka", quantity: oz, kind: "spirit", family: "vodka" },
        { name: "Triple sec", quantity: 0.5, kind: "liqueur", family: "liqueur" },
        { name: "Lemon juice", quantity: 0.75, kind: "juice", family: "citrus" },
        { name: "Simple syrup", quantity: 0.5, kind: "syrup", family: "syrup" },
      ],
    },
  ];
  return ex.map((e) => ({ name: e.name, rule: ruleprice(e.lines, p, { double: e.double }) }));
}
