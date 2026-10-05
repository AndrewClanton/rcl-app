// "What's in it?" (the Bar tab): a guest describes a drink ("vodka,
// cranberry and a splash of lime"), staff tap in the ingredients, and this
// says which drink it is. Plain functions, client-safe and deterministic:
// the same ingredients always give the same answer.
//
// - Spirits match by family: any vodka is vodka.
// - Everything else matches by its name, tidied ("Cranberry juice" is
//   cranberry, "Coke" is cola, "Cointreau" is orange liqueur), so a
//   grapefruit soda counts as grapefruit and soda water.
// - Drinks are scored on their required ingredients, the spirits weighing
//   most. Optional lines (a garnish, a float) never count against a match.
// - It never calls something a match when the spirits differ: a vodka
//   drink is never a gin drink.
//
// scripts/check-bar-book.mjs checks it on the drinks guests actually
// describe (Cape Codder, Sea Breeze or Bay Breeze, Paloma, Screwdriver or
// Harvey Wallbanger, a rum and Coke with lime).
import { FAMILY_LABEL, SPIRITS, familyFor, iconSpecFor, isFamily, isKind, kindFor, type Family, type IconSpec, type Kind } from "@/lib/bar/icons";

// One ingredient, as the picker and the book both have it.
export interface MatchIngredient {
  name: string;
  family?: string | null;
  kind?: string | null;
  optional?: boolean;
}

export interface Token {
  key: string; // "spirit:vodka", "cranberry", "soda water"
  label: string; // how it's said: "vodka", "cranberry juice"
  weight: number;
}

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Names that are the same thing behind the bar. Each maps to one or more
// tokens (a grapefruit soda is grapefruit and soda water).
const SAME: [RegExp, string[]][] = [
  [/^(grapefruit soda|squirt|fresca|jarritos grapefruit)$/, ["grapefruit", "soda water"]],
  [/^(cola|coke|coca cola|pepsi|diet coke|diet pepsi)$/, ["cola"]],
  [/^(soda water|club soda|soda|seltzer|sparkling water|mineral water|topo chico)$/, ["soda water"]],
  [/^(lemon lime soda|lemon lime|sprite|7 up|7up|seven up|starry|sierra mist)$/, ["lemon lime soda"]],
  [/^(triple sec|cointreau|grand marnier|orange liqueur|orange curacao|curacao|dry curacao)$/, ["orange liqueur"]],
  [/^(coffee liqueur|kahlua|tia maria)$/, ["coffee liqueur"]],
  [/^(irish cream|baileys)$/, ["irish cream"]],
  [/^(sour mix|sweet and sour|sweet and sour mix|sweet n sour)$/, ["sour mix"]],
  [/^(ginger beer)$/, ["ginger beer"]],
  [/^(ginger ale|canada dry)$/, ["ginger ale"]],
  [/^(tonic|tonic water)$/, ["tonic water"]],
  [/^(simple|simple syrup|sugar syrup|sugar)$/, ["simple syrup"]],
  [/^(angostura|angostura bitters|aromatic bitters|bitters)$/, ["angostura bitters"]],
  [/^(oj|orange|orange juice)$/, ["orange juice"]],
  [/^(lime|limes|lime juice|lime wedge|lime wedges)$/, ["lime"]],
  [/^(lemon|lemons|lemon juice)$/, ["lemon"]],
  [/^(cranberry|cranberry juice|cran)$/, ["cranberry"]],
  [/^(grapefruit|grapefruit juice)$/, ["grapefruit"]],
  [/^(pineapple|pineapple juice)$/, ["pineapple"]],
  [/^(prosecco|champagne|sparkling wine|cava|brut)$/, ["sparkling wine"]],
  [/^(energy drink|red bull|monster)$/, ["energy drink"]],
  [/^(cream|heavy cream|half and half)$/, ["cream"]],
  [/^(mint|mint leaves|fresh mint)$/, ["mint"]],
  [/^(agave|agave syrup|agave nectar)$/, ["agave syrup"]],
];

// Words that don't change what an ingredient is.
const NOISE = /\b(well|house|fresh|premium|call|squeezed|splash|of|a|the|bottle|can|fountain)\b/g;

function core(name: string): string {
  return strip(name).replace(NOISE, " ").replace(/\s+/g, " ").trim();
}

function weightOf(kind: Kind | null, spirit: boolean): number {
  if (spirit) return 3;
  if (kind === "liqueur") return 1.5;
  if (kind === "garnish" || kind === "bitters") return 0.5;
  return 1;
}

// What an ingredient counts as when matching.
export function tokensOf(i: MatchIngredient): Token[] {
  const kind: Kind = isKind(i.kind) ? i.kind : kindFor(i.name);
  const family: Family | null = isFamily(i.family) ? i.family : familyFor(i.name, { kind });
  if (kind === "spirit" && family && (SPIRITS as readonly string[]).includes(family)) {
    return [{ key: `spirit:${family}`, label: FAMILY_LABEL[family].toLowerCase(), weight: weightOf(kind, true) }];
  }
  const c = core(i.name);
  for (const [re, keys] of SAME) {
    if (re.test(c)) return keys.map((k) => ({ key: k, label: SAID[k] ?? k, weight: weightOf(kind, false) }));
  }
  // "Cranberry juice" and "cranberry" are one thing; a liqueur keeps its word.
  const key = c.replace(/\b(juice|syrup)\b/g, "").replace(/\s+/g, " ").trim() || c;
  return [{ key, label: said(i.name), weight: weightOf(kind, false) }];
}

// How a matched-up ingredient is said in a sentence.
const SAID: Record<string, string> = { "orange liqueur": "triple sec", "lemon lime soda": "lemon-lime soda", lime: "lime", lemon: "lemon", "angostura bitters": "bitters" };

// "Peach schnapps" reads "peach schnapps"; a name ("Galliano", "Southern
// Comfort") keeps its capitals.
function said(name: string): string {
  const n = name.trim();
  const words = n.split(/\s+/);
  if (words.length > 1 && words.slice(1).every((w) => w === w.toLowerCase())) return n.charAt(0).toLowerCase() + n.slice(1);
  return n;
}

const spiritsIn = (tokens: Iterable<Token>) => [...new Set([...tokens].filter((t) => t.key.startsWith("spirit:")).map((t) => t.key))].sort().join("|");

export interface Candidate<D> {
  drink: D;
  score: number; // 1 is the same drink
  missing: Token[]; // what the drink has that wasn't picked
  extra: Token[]; // what was picked that the drink doesn't have
  exact: boolean;
}

export interface MatchResult<D> {
  best: Candidate<D> | null; // "That's a Cape Codder"
  alternatives: (Candidate<D> & { text: string })[]; // up to 3
}

const dedupe = (tokens: Token[]) => {
  const m = new Map<string, Token>();
  for (const t of tokens) if (!m.has(t.key) || m.get(t.key)!.weight < t.weight) m.set(t.key, t);
  return [...m.values()];
};

// How close a drink is to what was picked.
export function compare<D extends { name: string; lines: readonly MatchIngredient[] }>(picked: readonly MatchIngredient[], drink: D): Candidate<D> | null {
  const want = dedupe(picked.flatMap(tokensOf));
  const required = dedupe(drink.lines.filter((l) => !l.optional).flatMap(tokensOf));
  const optional = new Set(drink.lines.filter((l) => l.optional).flatMap(tokensOf).map((t) => t.key));
  if (!required.length || !want.length) return null;
  // Never across spirits: the same spirit families, or none on both sides.
  if (spiritsIn(want) !== spiritsIn(required)) return null;
  const wantKeys = new Set(want.map((t) => t.key));
  const reqKeys = new Set(required.map((t) => t.key));
  const matched = required.filter((t) => wantKeys.has(t.key));
  const missing = required.filter((t) => !wantKeys.has(t.key));
  const extra = want.filter((t) => !reqKeys.has(t.key) && !optional.has(t.key));
  const sum = (ts: Token[]) => ts.reduce((s, t) => s + t.weight, 0);
  const score = sum(matched) / (sum(required) + sum(extra));
  return { drink, score: Math.round(score * 1000) / 1000, missing, extra, exact: missing.length === 0 && extra.length === 0 };
}

const article = (name: string) => (/^[aeiou]/i.test(name.trim()) && !/^(uni|one)/i.test(name.trim()) ? "an" : "a");
export const withArticle = (name: string) => `${article(name)} ${name}`;

function listOf(tokens: Token[]): string {
  const words = tokens.map((t) => t.label);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// "Add triple sec and it's a Cosmopolitan", "A Sea Breeze adds grapefruit",
// "Swap grapefruit for pineapple and it's a Bay Breeze".
export function diffText(c: Candidate<{ name: string }>): string {
  const name = c.drink.name;
  if (c.exact) return `That's ${withArticle(name)}.`;
  if (c.missing.length && !c.extra.length) {
    return c.missing.length === 1 ? `${capital(withArticle(name))} adds ${listOf(c.missing)}.` : `Add ${listOf(c.missing)} and it's ${withArticle(name)}.`;
  }
  if (c.extra.length && !c.missing.length) return `${capital(withArticle(name))}, without the ${listOf(c.extra)}.`;
  return `Swap ${listOf(c.extra)} for ${listOf(c.missing)} and it's ${withArticle(name)}.`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The headline for the best match: "That's a Cape Codder.", or for a near
// one, what's different: "That's a Paloma (it usually has lime too)."
export function bestText(c: Candidate<{ name: string }>): string {
  const that = `That's ${withArticle(c.drink.name)}`;
  if (c.exact) return `${that}.`;
  if (c.missing.length && !c.extra.length) return `${that} (it usually has ${listOf(c.missing)} too).`;
  if (c.extra.length && !c.missing.length) return `${that}, plus ${listOf(c.extra)}.`;
  return `Close to ${withArticle(c.drink.name)}: ${diffText(c)}`;
}

// Close enough to say "That's a …": the same drink, or one ingredient off
// that isn't a spirit (those already have to agree).
export const NEAR = 0.8;

export function matchDrinks<D extends { name: string; lines: readonly MatchIngredient[] }>(picked: readonly MatchIngredient[], drinks: readonly D[]): MatchResult<D> {
  const scored = drinks
    .map((d) => compare(picked, d))
    .filter((c): c is Candidate<D> => !!c && c.score > 0)
    // Best first; on a tie, the one that only adds to what was picked, then
    // the fewest differences, then A–Z (so it's always the same answer).
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.exact) - Number(a.exact) ||
        a.extra.length - b.extra.length ||
        a.missing.length + a.extra.length - (b.missing.length + b.extra.length) ||
        a.drink.name.localeCompare(b.drink.name),
    );
  const top = scored[0];
  const offByOne = top && top.missing.length + top.extra.length <= 1;
  const best = top && (top.exact || (top.score >= NEAR && offByOne)) ? top : null;
  // An alternative has to share more than the spirit (a vodka shot isn't a
  // near miss for a Screwdriver), and two drinks made the same way (a
  // Greyhound and a Salty Dog) show once.
  const pickedMixers = new Set(picked.flatMap(tokensOf).filter((t) => !t.key.startsWith("spirit:")).map((t) => t.key));
  const seen = new Set<string>();
  const alternatives: MatchResult<D>["alternatives"] = [];
  for (const c of scored) {
    if (c === best || c.score < 0.45) continue;
    const required = dedupe(c.drink.lines.filter((l) => !l.optional).flatMap(tokensOf));
    if (pickedMixers.size && !required.some((t) => pickedMixers.has(t.key))) continue;
    const sig = required.map((t) => t.key).sort().join("|");
    if (seen.has(sig) || (best && sig === dedupe(best.drink.lines.filter((l) => !l.optional).flatMap(tokensOf)).map((t) => t.key).sort().join("|"))) continue;
    seen.add(sig);
    alternatives.push({ ...c, text: diffText(c) });
    if (alternatives.length === 3) break;
  }
  return { best, alternatives };
}

// ---------- a drink nobody's named ----------

export interface PickedIngredient {
  id: string;
  name: string;
  unit: string;
  family: string | null;
  kind: string | null;
  amount: number;
}

// The starting amount for an ingredient by what it is: a pour of spirit, a
// splash of juice, two dashes of bitters, a long pour of mixer.
export function defaultAmount(kind: string | null | undefined): number {
  switch (kind) {
    case "spirit":
      return 1.5;
    case "liqueur":
      return 0.75;
    case "mixer":
    case "beer":
    case "wine":
      return 4;
    case "juice":
    case "syrup":
      return 0.5;
    case "bitters":
      return 0.05;
    default:
      return 0.5;
  }
}

// What − and + move it by.
export function amountStep(kind: string | null | undefined, unit?: string): number {
  if (unit === "count") return 1;
  if (kind === "bitters") return 0.025;
  if (kind === "mixer" || kind === "beer" || kind === "wine") return 0.5;
  return 0.25;
}

export const MAX_AMOUNT = 10;
export const MAX_LINES = 12;

export function nudge(amount: number, step: number, dir: 1 | -1): number {
  const next = Math.round((amount + dir * step) * 1000) / 1000;
  return Math.min(MAX_AMOUNT, Math.max(step, next));
}

// "Vodka, cranberry juice, lime juice": what a custom drink is called until
// staff name it. Spirits by family.
export function customName(picked: readonly PickedIngredient[]): string {
  const words = picked.map((p) => {
    const t = tokensOf(p)[0];
    return t.key.startsWith("spirit:") ? t.label : p.name.trim().toLowerCase();
  });
  const s = [...new Set(words)].join(", ");
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 80) || "Custom drink";
}

// A guess at the glass for a drink nobody's named: a shot of spirit alone,
// a tall one with a long mixer, else on the rocks.
export function customSpec(picked: readonly PickedIngredient[]): IconSpec {
  const oz = (p: PickedIngredient) => (p.unit === "count" ? 0 : p.unit === "ml" ? p.amount / 29.5735 : p.amount);
  const kinds = picked.map((p) => (isKind(p.kind) ? p.kind : kindFor(p.name)));
  const total = picked.reduce((s, p) => s + oz(p), 0);
  const long = picked.some((p, i) => (kinds[i] === "mixer" || kinds[i] === "juice") && oz(p) >= 3);
  const glass = kinds.every((k) => k === "spirit" || k === "liqueur") && total <= 2.5 ? "shot" : long ? "highball" : "rocks";
  return iconSpecFor({ glassware: glass, ice: glass === "shot" ? "none" : "cubes", ingredients: picked.map((p) => ({ name: p.name, quantity: p.amount, unit: p.unit, family: p.family, kind: p.kind })) }, "cocktails");
}

// Alcohol (so the ID check applies) when anything picked is.
export function customIsAlcohol(picked: readonly { name: string; kind?: string | null }[]): boolean {
  return picked.some((p) => {
    const k = isKind(p.kind) ? p.kind : kindFor(p.name);
    return k === "spirit" || k === "liqueur" || k === "beer" || k === "wine";
  });
}

// ---------- on the order ----------

// A custom drink's ingredients as an order line carries them
// (order_items.custom_recipe): ids and amounts from the register, names,
// units and colors filled in by the server from the database.
export interface CustomRecipeLine {
  ingredient_id: string;
  quantity: number;
  name?: string;
  unit?: string;
  family?: string | null;
  kind?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The list the server keeps, or null to drop it: only on a one-off line
// (no menu item, no Bar Book recipe, not a ticket), at most 12 lines, each
// a real ingredient (known: what the database has) with 0 < amount ≤ 10.
// The same ingredient twice is one line with both amounts. Anything else
// drops the whole list and the line saves as a plain custom line.
export function cleanCustomRecipe(
  line: { menu_item_id: string | null; screening_id?: string | null; recipe_id?: string | null; custom_recipe?: unknown },
  known: ReadonlyMap<string, { name: string; unit: string; family: string | null; kind: string | null }>,
): CustomRecipeLine[] | null {
  if (line.menu_item_id || line.screening_id || line.recipe_id) return null;
  const raw = line.custom_recipe;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const merged = new Map<string, number>();
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const id = typeof (r as { ingredient_id?: unknown }).ingredient_id === "string" ? (r as { ingredient_id: string }).ingredient_id.toLowerCase() : "";
    const q = (r as { quantity?: unknown }).quantity;
    if (!UUID.test(id) || !known.has(id)) return null;
    if (typeof q !== "number" || !Number.isFinite(q) || q <= 0 || q > MAX_AMOUNT) return null;
    merged.set(id, Math.round(((merged.get(id) ?? 0) + q) * 1000) / 1000);
  }
  const out: CustomRecipeLine[] = [];
  for (const [id, quantity] of merged) {
    if (quantity > MAX_AMOUNT) return null;
    const k = known.get(id)!;
    out.push({ ingredient_id: id, quantity, name: k.name, unit: k.unit, family: k.family, kind: k.kind });
  }
  return out;
}

// The line a custom drink puts on the order: the same one-off line as
// "+ Custom item", named by staff, alcohol when anything in it is, and
// carrying what's in it (ids and amounts; the server fills in the rest).
export interface CustomOrderLine {
  menuItemId: null;
  name: string;
  unit: number;
  qty: 1;
  mods: string[];
  isAlcohol: boolean;
  customRecipe: { ingredient_id: string; quantity: number }[];
}

export function customOrderLine(name: string, price: number, picked: readonly PickedIngredient[]): CustomOrderLine {
  const merged = new Map<string, number>();
  for (const p of picked.slice(0, MAX_LINES)) merged.set(p.id, Math.min(MAX_AMOUNT, Math.round(((merged.get(p.id) ?? 0) + p.amount) * 1000) / 1000));
  return {
    menuItemId: null,
    name: name.replace(/\s+/g, " ").trim().slice(0, 80) || customName(picked),
    unit: Math.round(price * 100) / 100,
    qty: 1,
    mods: [],
    isAlcohol: customIsAlcohol(picked),
    customRecipe: [...merged].map(([ingredient_id, quantity]) => ({ ingredient_id, quantity })),
  };
}

// "vodka 1.5 oz, cranberry juice 4 oz": a custom drink's list in a line of text.
export function customRecipeText(lines: readonly CustomRecipeLine[] | null | undefined): string {
  if (!Array.isArray(lines)) return "";
  return lines
    .filter((l) => l && typeof l.name === "string")
    .map((l) => `${l.name!.toLowerCase()} ${Number(l.quantity)}${l.unit === "count" ? "" : ` ${l.unit ?? "oz"}`}`)
    .join(", ");
}
