// Drink icons drawn from a recipe (The Royale Bar Book, Oct 2026): the right
// glass, filled from the bottom with its ingredients' colors in proportion,
// ice, then the garnish. Nothing is hand-drawn, so a new drink gets its icon
// the moment its recipe is saved.
//
// Client-safe and self-contained: no imports from the server, the database
// or Next. The SVG it returns uses literal hex colors for the drink (the
// spirit legend is fixed, so staff learn one code) and currentColor for the
// glass outline, so the same string looks the same inline on the register,
// on the bar display, or as a data URI. Every bit of text in it is escaped.
//
// Used by <DrinkIcon> (src/components/bar/DrinkIcon.tsx), the register's Bar
// tab and Bar Book, and the bar display. scripts/check-bar-book.mjs checks it.

export const GLASSES = ["rocks", "highball", "coupe", "martini", "margarita", "mug", "shot", "pint", "wine"] as const;
export type GlassKey = (typeof GLASSES)[number];

export const FAMILIES = [
  "whiskey",
  "rum",
  "gin",
  "vodka",
  "tequila",
  "brandy",
  "liqueur",
  "coffee",
  "vermouth",
  "citrus",
  "grapefruit",
  "ginger",
  "cola",
  "cream",
  "syrup",
  "soda",
  "beer",
  "wine",
] as const;
export type Family = (typeof FAMILIES)[number];

export const KINDS = ["spirit", "liqueur", "mixer", "juice", "syrup", "bitters", "garnish", "beer", "wine", "other"] as const;
export type Kind = (typeof KINDS)[number];

export const GARNISHES = ["salt", "lime", "lemon", "cherry", "orange", "mint", "whip"] as const;
export type GarnishKey = (typeof GARNISHES)[number];

export const METHODS = ["build", "shake", "stir", "blend"] as const;
export type Method = (typeof METHODS)[number];

export const ICE = ["none", "cubes", "crushed"] as const;
export type Ice = (typeof ICE)[number];

// The fixed legend. The same in every theme, so the tequila drinks are
// always that yellow.
export const FAMILY_COLOR: Record<Family, string> = {
  whiskey: "#c27a2c",
  rum: "#8a3b22",
  tequila: "#cdb84a",
  vodka: "#9cc3e6",
  gin: "#6fb69c",
  liqueur: "#8c4a86",
  brandy: "#a4502f",
  coffee: "#4a2c1d",
  vermouth: "#7a1f2b",
  citrus: "#b9d33f",
  grapefruit: "#ef8f80",
  ginger: "#e5cf8a",
  cola: "#3a2216",
  cream: "#efe6d6",
  syrup: "#d9a441",
  soda: "#d8e6ea",
  beer: "#e0a930",
  wine: "#7b1e3a",
};

export const FAMILY_LABEL: Record<Family, string> = {
  whiskey: "Whiskey",
  rum: "Rum",
  gin: "Gin",
  vodka: "Vodka",
  tequila: "Tequila",
  brandy: "Brandy",
  liqueur: "Liqueur",
  coffee: "Coffee liqueur",
  vermouth: "Vermouth & bitters",
  citrus: "Lime & lemon",
  grapefruit: "Grapefruit & red juice",
  ginger: "Ginger beer & pale juice",
  cola: "Cola",
  cream: "Cream",
  syrup: "Syrup & orange juice",
  soda: "Soda & tonic",
  beer: "Beer",
  wine: "Wine",
};

// The spirits a drink is tinted by on the register, strongest first when
// a drink has two in equal measure.
export const SPIRITS: readonly Family[] = ["tequila", "whiskey", "rum", "gin", "vodka", "brandy"];

export const isGlass = (v: unknown): v is GlassKey => typeof v === "string" && (GLASSES as readonly string[]).includes(v);
export const isFamily = (v: unknown): v is Family => typeof v === "string" && (FAMILIES as readonly string[]).includes(v);
export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
export const isGarnish = (v: unknown): v is GarnishKey => typeof v === "string" && (GARNISHES as readonly string[]).includes(v);
export const isMethod = (v: unknown): v is Method => typeof v === "string" && (METHODS as readonly string[]).includes(v);
export const isIce = (v: unknown): v is Ice => typeof v === "string" && (ICE as readonly string[]).includes(v);

// ---------- glasses ----------
// Drawn on a 100x100 box: the outline, the inside the liquid is clipped to,
// where a full pour's top and the bowl's bottom sit, and the rim line
// [x1, y, x2] the garnish sits on.
interface Glass {
  outline: string;
  clip: string;
  top: number;
  bottom: number;
  rim: [number, number, number];
  ice: number; // cubes when it's served on ice
  copper?: boolean;
}

const GLASS: Record<GlassKey, Glass> = {
  rocks: { outline: "M18 30 L22 88 Q22 92 26 92 L74 92 Q78 92 78 88 L82 30 Z", clip: "M19.5 32 L23.4 87 Q23.5 90 26 90 L74 90 Q76.5 90 76.6 87 L80.5 32 Z", top: 36, bottom: 90, rim: [18, 30, 82], ice: 2 },
  highball: { outline: "M28 12 L31 90 Q31 93 34 93 L66 93 Q69 93 69 90 L72 12 Z", clip: "M29.6 14 L32.4 89 Q32.6 91 34.5 91 L65.5 91 Q67.4 91 67.6 89 L70.4 14 Z", top: 20, bottom: 91, rim: [28, 12, 72], ice: 3 },
  coupe: { outline: "M14 26 Q16 54 50 56 Q84 54 86 26 Z M48 56 L48 84 M52 56 L52 84 M34 90 Q50 82 66 90 Z", clip: "M16 28 Q18 52 50 54 Q82 52 84 28 Z", top: 30, bottom: 54, rim: [14, 26, 86], ice: 0 },
  martini: { outline: "M12 22 L50 58 L88 22 Z M48 58 L48 86 M52 58 L52 86 M34 92 Q50 84 66 92 Z", clip: "M15 24 L50 55 L85 24 Z", top: 26, bottom: 55, rim: [12, 22, 88], ice: 0 },
  margarita: {
    outline: "M10 22 Q12 40 36 42 Q30 50 40 56 L48 58 L48 84 M52 58 L52 84 L52 58 L60 56 Q70 50 64 42 Q88 40 90 22 Z M34 92 Q50 84 66 92 Z",
    clip: "M12 24 Q14 39 36 40 Q31 48 41 54 L50 56 L59 54 Q69 48 64 40 Q86 39 88 24 Z",
    top: 26,
    bottom: 56,
    rim: [10, 22, 90],
    ice: 0,
  },
  mug: { outline: "M22 20 L26 90 Q26 93 30 93 L66 93 Q70 93 70 90 L74 20 Z M74 34 Q90 34 90 52 Q90 70 72 70", clip: "M23.6 22 L27.4 89 Q27.6 91 30.5 91 L65.5 91 Q68.4 91 68.6 89 L72.4 22 Z", top: 26, bottom: 91, rim: [22, 20, 74], ice: 3, copper: true },
  shot: { outline: "M32 40 L36 90 Q36 92 38 92 L62 92 Q64 92 64 90 L68 40 Z", clip: "M33.6 42 L37.4 89 Q37.6 90.5 39 90.5 L61 90.5 Q62.4 90.5 62.6 89 L66.4 42 Z", top: 48, bottom: 90.5, rim: [32, 40, 68], ice: 0 },
  pint: { outline: "M24 10 L30 90 Q30 93 34 93 L66 93 Q70 93 70 90 L76 10 Z", clip: "M25.7 12 L31.6 89 Q31.8 91 34.5 91 L65.5 91 Q68.2 91 68.4 89 L74.3 12 Z", top: 16, bottom: 91, rim: [24, 10, 76], ice: 0 },
  wine: {
    outline: "M30 10 Q24 40 34 52 Q42 60 50 60 Q58 60 66 52 Q76 40 70 10 Z M48 60 L48 86 M52 60 L52 86 M34 92 Q50 84 66 92 Z",
    clip: "M31.7 12 Q26.5 40 35.5 51 Q42.5 58 50 58 Q57.5 58 64.5 51 Q73.5 40 68.3 12 Z",
    top: 30,
    bottom: 58,
    rim: [30, 10, 70],
    ice: 0,
  },
};

export const GLASS_LABEL: Record<GlassKey, string> = {
  rocks: "Rocks glass",
  highball: "Highball",
  coupe: "Coupe",
  martini: "Martini glass",
  margarita: "Margarita glass",
  mug: "Copper mug",
  shot: "Shot glass",
  pint: "Pint glass",
  wine: "Wine glass",
};

export const METHOD_LABEL: Record<Method, string> = { build: "Built", shake: "Shaken", stir: "Stirred", blend: "Blended" };

// ---------- reading recipe text ----------

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'");

// recipes.glassware is free text ("Copper mug", "rocks glass, big cube",
// "Collins"). Null when it names no glass we draw.
export function normalizeGlass(text: string | null | undefined): GlassKey | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = squash(text);
  if (isGlass(t.trim())) return t.trim() as GlassKey;
  const rules: [RegExp, GlassKey][] = [
    [/copper|\bmule\b/, "mug"],
    [/\b(beer|pint|pilsner|stein|schooner|tulip pint)\b/, "pint"],
    [/\bmug\b|irish coffee/, "mug"],
    [/margarita/, "margarita"],
    [/martini|cocktail glass|\bv[- ]?glass/, "martini"],
    [/coupe|nick (and|&) nora|saucer/, "coupe"],
    [/\bshot|shooter|\bpony\b/, "shot"],
    [/wine|flute|champagne|goblet|snifter|balloon|\bstemmed\b/, "wine"],
    [/highball|collins|\btall\b|hurricane|chimney|zombie|tiki|mason jar/, "highball"],
    [/rocks|old[- ]?fashioned|lowball|tumbler|\bdouble\b|whiske?y glass|\bneat\b/, "rocks"],
  ];
  for (const [re, key] of rules) if (re.test(t)) return key;
  return null;
}

// recipes.garnish is free text ("Salt rim, lime wheel"), recipes.garnishes a
// list of the same. Gives the garnishes we draw, in the order they're named.
// "Twist" alone is a lemon twist; a sugar rim draws like a salt rim.
export function parseGarnishes(text: string | readonly string[] | null | undefined): GarnishKey[] {
  const all = Array.isArray(text) ? text.join(", ") : typeof text === "string" ? text : "";
  if (!all.trim()) return [];
  const t = squash(all);
  if (/^\s*(none|no garnish|n\/a|-)\s*$/.test(t)) return [];
  const rules: [RegExp, GarnishKey][] = [
    [/\bsalt(ed)?\b|\bsugar(ed)?[- ]rim|\brim(med)? with sugar/, "salt"],
    [/\blimes?\b/, "lime"],
    [/\blemons?\b|(^|[,;]\s*)twist\b/, "lemon"],
    [/\bcherr(y|ies)\b|maraschino|luxardo/, "cherry"],
    [/\borange\b/, "orange"],
    [/\bmint\b/, "mint"],
    [/whip(ped)?\b|whipped cream/, "whip"],
  ];
  const found: { key: GarnishKey; at: number }[] = [];
  for (const [re, key] of rules) {
    const m = re.exec(t);
    if (m) found.push({ key, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.key);
}

// An ingredient's color family: what the database says (ingredients.family,
// once the Bar Book migration is in), else read from its name. Null when
// the name says nothing we know.
export function familyFor(name: string | null | undefined, hint?: { family?: string | null; kind?: string | null }): Family | null {
  if (hint && isFamily(hint.family)) return hint.family;
  const n = squash(typeof name === "string" ? name : "");
  if (n) {
    for (const [re, fam] of FAMILY_RULES) if (re.test(n)) return fam;
  }
  const kind = hint?.kind;
  if (kind === "beer") return "beer";
  if (kind === "wine") return "wine";
  if (kind === "syrup") return "syrup";
  if (kind === "bitters") return "vermouth";
  if (kind === "liqueur") return "liqueur";
  if (kind === "mixer") return "soda";
  return null;
}

// Most specific first: "sloe gin" is a liqueur, "ginger beer" isn't gin or
// beer, "coffee liqueur" is coffee, "Irish cream" is cream.
const FAMILY_RULES: [RegExp, Family][] = [
  [/cream soda/, "ginger"],
  [/lemon[- ]lime|\bsprite\b|\b7[- ]?up\b|seven[- ]up/, "soda"],
  [/irish cream|baileys|rumchata|cream liqueur|\bcream of coconut|coconut cream|half (and|&) half|heavy cream|\bmilk\b|egg white|ice cream|whipped cream|\bcream\b/, "cream"],
  [/coffee|kahlua|espresso|cold brew|licor 43 coffee/, "coffee"],
  [/ginger (beer|ale)|cream soda|pineapple|apple juice|\bcider\b|prosecco|champagne|sparkling wine|\bcava\b|white wine|pinot grigio|sauvignon|chardonnay|riesling|moscato|vivace|\bmead\b|lillet/, "ginger"],
  [/sloe gin|schnapps|triple sec|cointreau|curacao|grand marnier|amaretto|frangelico|chambord|raspberry liqueur|elderflower|st[- .]?germain|midori|maraschino liqueur|chartreuse|benedictine|drambuie|galliano|creme de|liqueur|limoncello|jagermeister|\bjager\b|absinthe|aperol|campari|licor 43|\bamaro\b|southern comfort|goldschlager|peach schnapps/, "liqueur"],
  [/vermouth|bitters|angostura|peychaud/, "vermouth"],
  [/\bcola\b|\bcoke\b|coca[- ]?cola|pepsi|dr\.? pepper|root beer|worcestershire/, "cola"],
  [/grapefruit|cranberry|tomato|clamato|bloody mary mix|grenadine|pomegranate|raspberry|strawberr|watermelon|hot sauce|tabasco|grape juice|\brose\b|hibiscus/, "grapefruit"],
  [/\blimes?\b|\blemons?\b|sour mix|sweet (and|&|n) sour|margarita mix|lemonade|limeade|jalapeno|\bmint\b|cucumber|celery/, "citrus"],
  [/whiske?y|bourbon|\brye\b|scotch|crown royal|jack daniel|jameson|buffalo trace|woodford|maker'?s mark|wild turkey|seagram|american honey|fireball|jim beam|bulleit|knob creek|tennessee|seagram/, "whiskey"],
  [/\brum\b|bacardi|captain morgan|meyers|malibu|kraken|sailor jerry|cachaca/, "rum"],
  [/\bgin\b|tanqueray|bombay|hendrick|beefeater/, "gin"],
  [/vodka|tito'?s|absolut|grey goose|smirnoff|ketel|stoli/, "vodka"],
  [/tequila|mezcal|patron|don julio|cuervo|jimador|espolon|casamigos/, "tequila"],
  [/brandy|cognac|hennessy|pisco|calvados|applejack/, "brandy"],
  [/\bsimple\b|syrup|\bsugar\b|\bhoney\b|agave|orgeat|maple|demerara|orange juice|\boj\b|butterscotch|caramel|peach puree|energy drink|red bull|iced tea|\btea\b/, "syrup"],
  [/\bbeer\b|lager|\bale\b|\bipa\b|stout|porter|pilsner|\bbock|amberbock|dunkel|hefeweizen|guinness|budweiser|\bbud\b|bud light|coors|miller|michelob|ultra|stella|corona|modelo|pacifico|dos equis|kona|big wave|space dust|mango cart|o'?doul|twisted tea/, "beer"],
  [/\bwine\b|merlot|cabernet|pinot noir|malbec|zinfandel|sangria|\bport\b|\bred\b/, "wine"],
  [/soda water|club soda|seltzer|sparkling water|tonic|sprite|7[- ]?up|lemon[- ]lime|\bsoda\b|\bwater\b|olive brine|brine|\bsalt\b/, "soda"],
];

// What kind of ingredient a name is, for the Bar Book (spirit, juice...).
export function kindFor(name: string | null | undefined, hint?: { kind?: string | null }): Kind {
  if (hint && isKind(hint.kind)) return hint.kind;
  const n = squash(typeof name === "string" ? name : "");
  if (!n) return "other";
  if (/bitters|angostura|peychaud/.test(n)) return "bitters";
  if (/wedge|wheel|twist|peel|\bslice|garnish|cherr(y|ies)|\bolives?\b(?!\s*brine)|celery|nutmeg|mint|\bsalt\b|sugar rim|jalapeno|cucumber/.test(n)) return "garnish";
  if (/juice|lemonade|limeade|puree|clamato/.test(n)) return "juice";
  if (/syrup|grenadine|orgeat|\bhoney\b|agave|\bsugar\b|cream of coconut/.test(n)) return "syrup";
  const fam = familyFor(n);
  if (fam === "liqueur" || /liqueur|kahlua|irish cream|baileys|rumchata|vermouth|lillet/.test(n)) return "liqueur";
  if (fam === "coffee") return "mixer";
  if (fam === "beer") return "beer";
  if (fam === "wine" || /prosecco|champagne|sparkling wine|white wine|\bcava\b/.test(n)) return "wine";
  if (fam && (SPIRITS as readonly string[]).includes(fam)) return "spirit";
  if (fam) return "mixer";
  return "other";
}

// ---------- icon specs ----------

export interface IconLayer {
  family: Family;
  amount: number; // oz
}

// Everything needed to draw one drink. Plain data, so a server page can
// work it out and hand it to the board or the register as a prop.
export interface IconSpec {
  glass: GlassKey;
  layers: IconLayer[]; // bottom first
  ice: number; // cubes
  garnishes: GarnishKey[];
  base: Family | null; // the spirit it's tinted by on the register
}

// What a bar menu section looks like with no recipe to go on.
export type BarSection = "beer" | "wine" | "cocktails" | "shots" | "other";

export function fallbackSpec(section: BarSection | null | undefined): IconSpec {
  switch (section) {
    case "beer":
      return { glass: "pint", layers: [{ family: "beer", amount: 1 }], ice: 0, garnishes: [], base: "beer" };
    case "wine":
      return { glass: "wine", layers: [{ family: "wine", amount: 1 }], ice: 0, garnishes: [], base: "wine" };
    case "shots":
      return { glass: "shot", layers: [{ family: "whiskey", amount: 1 }], ice: 0, garnishes: [], base: null };
    default:
      return { glass: "rocks", layers: [{ family: "syrup", amount: 1 }], ice: 2, garnishes: [], base: null };
  }
}

export interface IconIngredient {
  name: string;
  quantity: number;
  unit?: string | null; // oz, ml or count
  family?: string | null;
  kind?: string | null;
}

export interface IconRecipe {
  glassware?: string | null; // free text, or a glass key
  garnish?: string | null; // free text
  garnishes?: readonly string[] | null;
  ice?: string | null; // none, cubes, crushed; null to go by the glass
  ingredients: readonly IconIngredient[];
}

// The ounces a line pours, or 0 when it isn't poured (a count of wedges, a
// garnish, a bad number).
function pourOz(i: IconIngredient): number {
  const q = Number(i.quantity);
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (i.unit === "count") return 0;
  if (i.unit === "ml") return q / 29.5735;
  return q;
}

// The spirit a drink is tinted by: the spirit with the biggest pour, else a
// liqueur, else beer or wine. Null for a drink with none of those.
export function baseOf(layers: readonly IconLayer[]): Family | null {
  const total = new Map<Family, number>();
  for (const l of layers) total.set(l.family, (total.get(l.family) ?? 0) + l.amount);
  let best: Family | null = null;
  let bestAmt = 0;
  for (const s of SPIRITS) {
    const a = total.get(s) ?? 0;
    if (a > bestAmt) {
      best = s;
      bestAmt = a;
    }
  }
  if (best) return best;
  for (const f of ["liqueur", "coffee", "beer", "wine"] as Family[]) if ((total.get(f) ?? 0) > 0) return f === "coffee" ? "liqueur" : f;
  return null;
}

// A recipe's icon. With no poured ingredients it's the section's fallback,
// in the recipe's glass when it names one.
export function iconSpecFor(recipe: IconRecipe | null | undefined, section: BarSection | null = "cocktails"): IconSpec {
  const fb = fallbackSpec(section);
  if (!recipe) return fb;
  const glass = normalizeGlass(recipe.glassware) ?? fb.glass;
  const poured: { family: Family; amount: number }[] = [];
  for (const i of recipe.ingredients ?? []) {
    const oz = pourOz(i);
    if (oz <= 0) continue;
    if (i.kind === "garnish") continue;
    const family = familyFor(i.name, i) ?? "syrup";
    poured.push({ family, amount: oz });
  }
  // Listed spirit first, so the spirit is drawn on top and the mixers
  // under it; a cream float always sits on top.
  const layers = poured.reverse();
  const cream = layers.filter((l) => l.family === "cream");
  const rest = layers.filter((l) => l.family !== "cream");
  const ordered = [...rest, ...cream];
  const g = GLASS[glass];
  const iceText = typeof recipe.ice === "string" ? recipe.ice : null;
  const neatOrUp = /\b(neat|up)\b/i.test(recipe.glassware ?? "");
  let ice = neatOrUp ? 0 : g.ice;
  if (iceText === "none") ice = 0;
  else if (iceText === "cubes" || iceText === "crushed") ice = g.ice > 0 ? g.ice : glass === "shot" ? 0 : 2;
  const garnishes = parseGarnishes([...(recipe.garnishes ?? []), ...(recipe.garnish ? [recipe.garnish] : [])]);
  if (ordered.length === 0) return { ...fb, glass, ice: glass === fb.glass ? fb.ice : ice, garnishes };
  return { glass, layers: ordered, ice, garnishes, base: baseOf(ordered) };
}

// ---------- drawing ----------

export function escapeXml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const num = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);

// A short, stable id for the clip path when the caller gives none (a data
// URI, a server string). Inline on a page, pass a unique one (useId).
function hashId(spec: IconSpec, size: number): string {
  const s = JSON.stringify([spec.glass, spec.layers, spec.ice, spec.garnishes, size]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `di${(h >>> 0).toString(36)}`;
}

function garnishSvg(k: GarnishKey, rim: [number, number, number]): string {
  const [x1, ry, x2] = rim;
  switch (k) {
    case "salt":
      return `<line x1="${x1}" y1="${ry}" x2="${x2}" y2="${ry}" stroke="#ffffff" stroke-width="3.5" stroke-dasharray="1.5 2.2" stroke-linecap="round"/>`;
    case "lime": {
      const y = Math.max(ry - 4, 11);
      return `<g transform="translate(${x2 - 4} ${y})"><circle r="9" fill="#b9d33f" stroke="#4f6b12" stroke-width="1.6"/><path d="M0 -7 V7 M-7 0 H7 M-5 -5 L5 5 M5 -5 L-5 5" stroke="#f2f7d6" stroke-width="1"/></g>`;
    }
    case "lemon": {
      const y = Math.max(ry - 4, 10);
      return `<g transform="translate(${x2 - 4} ${y})"><circle r="8" fill="#f5d94a" stroke="#a88a10" stroke-width="1.5"/><path d="M0 -6 V6 M-6 0 H6" stroke="#fff7c9" stroke-width="1"/></g>`;
    }
    case "cherry": {
      const y = Math.max(ry - 7, 24);
      return `<g transform="translate(${num((x1 + x2) / 2 + 6)} ${y})"><path d="M0 0 Q4 -12 12 -16" stroke="#3d6b2a" stroke-width="1.8" fill="none"/><circle r="6" fill="#c8141b"/><circle cx="-2" cy="-2" r="1.6" fill="#ff9aa0"/></g>`;
    }
    case "orange": {
      const y = Math.max(ry - 4, 14);
      return `<path d="M${x1 + 6} ${y} q10 -10 22 -2 q-10 2 -22 2 z" fill="#f08a1c" stroke="#b85b0a" stroke-width="1.2"/>`;
    }
    case "mint": {
      const y = Math.max(ry - 6, 22);
      return `<g transform="translate(${x1 + 14} ${y})"><path d="M0 0 q-8 -10 2 -16 q6 8 -2 16 z" fill="#3f9b52"/><path d="M4 0 q2 -12 12 -12 q0 10 -12 12 z" fill="#2f7d40"/></g>`;
    }
    case "whip":
      return `<path d="M${x1 + 2} ${ry + 2} q8 -14 16 -6 q8 -12 16 -2 q8 -12 16 0 q4 -6 6 8 z" fill="#fbf6ec" stroke="#d9cdb6" stroke-width="1"/>`;
  }
}

export interface IconOptions {
  size?: number;
  id?: string; // unique on the page; letters, digits, - and _ are kept
  label?: string | null; // spoken name; none hides it from screen readers
}

// The icon as an SVG string. Every value in it is a number we computed, a
// fixed color, or escaped text.
export function drinkIconSvg(spec: IconSpec, opts: IconOptions = {}): string {
  const size = Number.isFinite(opts.size) && (opts.size as number) > 0 ? Math.round(opts.size as number) : 96;
  const glassKey: GlassKey = isGlass(spec?.glass) ? spec.glass : "rocks";
  const g = GLASS[glassKey];
  const rawId = (opts.id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const id = rawId ? `di${rawId}` : hashId({ ...spec, glass: glassKey }, size);

  const layers = (Array.isArray(spec?.layers) ? spec.layers : []).filter((l) => isFamily(l?.family) && Number.isFinite(l.amount) && l.amount > 0);
  const total = layers.reduce((s, l) => s + l.amount, 0);
  const span = g.bottom - g.top;
  // A dash of bitters still shows: no layer thinner than 6% of the glass.
  const minShare = layers.length > 1 ? 0.06 : 0;
  const shares = layers.map((l) => Math.max(l.amount / total, minShare));
  const shareSum = shares.reduce((s, x) => s + x, 0) || 1;
  let y = g.bottom;
  let fills = "";
  layers.forEach((l, i) => {
    const h = (shares[i] / shareSum) * span;
    y -= h;
    fills += `<rect x="0" y="${num(y)}" width="100" height="${num(h + 0.6)}" fill="${FAMILY_COLOR[l.family]}"/>`;
  });

  let ice = "";
  const cubes = Math.max(0, Math.min(4, Math.floor(Number(spec?.ice) || 0)));
  if (layers.length > 0) {
    for (let i = 0; i < cubes; i++) {
      const x = 34 + (i % 2) * 18 + (i > 1 ? 6 : 0);
      const yy = g.top + 6 + i * 12;
      ice += `<rect x="${x}" y="${yy}" width="14" height="12" rx="2.5" fill="#ffffff" fill-opacity="0.45" stroke="#ffffff" stroke-opacity="0.8" stroke-width="1"/>`;
    }
  }

  // The salt rim, then at most two more: more than that is mush at 36px.
  const gar = Array.isArray(spec?.garnishes) ? [...new Set(spec.garnishes.filter(isGarnish))] : [];
  const salt = gar.includes("salt");
  const others = gar.filter((k) => k !== "salt").slice(0, 2);
  const garnish = (salt ? garnishSvg("salt", g.rim) : "") + others.map((k) => garnishSvg(k, g.rim)).join("");

  const stroke = size < 48 ? 3.6 : size < 72 ? 3 : 2.6;
  const copper = g.copper ? `<path d="${g.clip}" fill="#b8693a" fill-opacity="0.22"/>` : "";
  const label = typeof opts.label === "string" && opts.label.trim() ? opts.label.trim() : null;
  const a11y = label ? `role="img" aria-label="${escapeXml(label)}"` : `aria-hidden="true" focusable="false"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" ${a11y}>` +
    (label ? `<title>${escapeXml(label)}</title>` : "") +
    `<defs><clipPath id="${id}"><path d="${g.clip}"/></clipPath></defs>` +
    `<path d="${g.clip}" fill="currentColor" fill-opacity="0.05"/>${copper}` +
    `<g clip-path="url(#${id})">${fills}${ice}</g>` +
    `<path d="${g.outline}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>` +
    garnish +
    `</svg>`
  );
}

// The same icon as a data URI (an <img src>, a CSS background). Outside a
// page the outline has no text color to follow, so pass one.
export function drinkIconDataUri(spec: IconSpec, opts: IconOptions & { color?: string } = {}): string {
  const color = /^#[0-9a-f]{3,8}$/i.test(opts.color ?? "") ? (opts.color as string) : "#14110c";
  const svg = drinkIconSvg(spec, opts).replace("<svg ", `<svg color="${color}" `);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// A soft tint of a family's color, for a tile's background where
// color-mix() isn't supported (older iPad Safari).
export function tintRgba(family: Family | null, alpha: number): string {
  const hex = family ? FAMILY_COLOR[family] : "#6b6455";
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
