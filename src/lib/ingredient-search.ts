// Search for the recipe editor's ingredient picker, and the guesses it makes
// when someone adds an ingredient we don't have yet. Pure functions (no
// React, no database) so they can be checked with a plain node script.
//
// The picker searches two lists: the ingredients recipes already use, and
// the par sheet (Register → shift tools), which has everything we buy.
// Matching is case-insensitive, on the name and on where it lives
// (category, par sheet area and section), and it forgives a small typo:
// "tarani" finds "Torani coconut".

import type { Ingredient, IngredientUnit, ParItemRef } from "@/lib/types";

// ---------- words ----------

// Lowercase, accents off, apostrophes dropped ("Tito's" → "titos",
// "M&M's" → "m&ms"), then split on anything that isn't a letter or digit.
export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Letters and digits only: "SF vanilla" and "sf-vanilla" are the same name.
export function nameKey(text: string | null | undefined): string {
  return words(text).join("");
}

// Typos forgiven per word: none under 4 letters, 1 from 4, 2 from 7.
export function allowedTypos(length: number): number {
  return length >= 7 ? 2 : length >= 4 ? 1 : 0;
}

// Edit distance (insert, delete, change, or swap two neighbours), giving up
// early once it's past `max`.
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prevPrev[j - 2] + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}

type WordMatch = "exact" | "prefix" | "inside" | "typo" | null;

// How one typed word matches one word of a name.
function matchWord(typed: string, word: string): WordMatch {
  if (typed === word) return "exact";
  if (word.startsWith(typed)) return "prefix";
  if (typed.length >= 3 && word.includes(typed)) return "inside";
  const typos = allowedTypos(typed.length);
  if (typos === 0) return null;
  if (editDistance(typed, word, typos) <= typos) return "typo";
  // Still typing: "tara" is one letter off the start of "torani".
  if (word.length > typed.length && editDistance(typed, word.slice(0, typed.length), typos) <= typos) return "typo";
  return null;
}

const WORD_POINTS: Record<Exclude<WordMatch, null>, number> = { exact: 100, prefix: 80, inside: 40, typo: 35 };

interface Field {
  text: string | null | undefined;
  weight: number;
}

// A score for how well `query` matches, or null when some typed word
// matches nothing. Every typed word has to land somewhere (name, category,
// area or section); the name counts most. A name that is the query, or
// starts with it, goes to the top.
export function matchScore(query: string, name: string, others: Field[] = []): number | null {
  const typed = words(query);
  if (typed.length === 0) return null;
  const fields: { words: string[]; weight: number }[] = [
    { words: words(name), weight: 1 },
    ...others.map((f) => ({ words: words(f.text), weight: f.weight })),
  ];
  let total = 0;
  for (const t of typed) {
    let best = 0;
    for (const f of fields) {
      for (const w of f.words) {
        const m = matchWord(t, w);
        if (m) best = Math.max(best, WORD_POINTS[m] * f.weight);
      }
    }
    if (best === 0) return null;
    total += best;
  }
  const q = nameKey(query);
  const n = nameKey(name);
  if (n === q) total += 1000;
  else if (n.startsWith(q)) total += 500;
  return total;
}

// ---------- the picker's results ----------

// "Coffee › Syrups"
export function parPlace(p: Pick<ParItemRef, "area" | "section">): string {
  return p.section ? `${p.area} › ${p.section}` : p.area;
}

// "Coffee › Syrups · Finicky Fox"
export function parPlaceAndSource(p: Pick<ParItemRef, "area" | "section" | "source">): string {
  return p.source ? `${parPlace(p)} · ${p.source}` : parPlace(p);
}

export interface PickerResults {
  // Active ingredients not already in this recipe. For an empty query, all
  // of them, by category then name; otherwise the best matches first.
  ingredients: Ingredient[];
  // Active par sheet lines no ingredient is linked to yet (empty for an
  // empty query).
  parItems: ParItemRef[];
  // How many matches were left off the end of each list.
  moreIngredients: number;
  moreParItems: number;
  // The query already names an ingredient or par line (ignoring case and
  // punctuation), so "Add as a new ingredient" isn't offered.
  exact: boolean;
  // ...and if it's an ingredient that's already in this recipe, its name.
  alreadyInRecipe: string | null;
}

export function searchPicker(
  query: string,
  opts: { ingredients: Ingredient[]; parItems: ParItemRef[]; usedIngredientIds: Iterable<string>; limit?: number },
): PickerResults {
  const used = new Set(opts.usedIngredientIds);
  const limit = opts.limit ?? 20;
  const activePar = opts.parItems.filter((p) => p.active);
  const parById = new Map(activePar.map((p) => [p.id, p]));
  const linked = new Set(opts.ingredients.map((i) => i.par_item_id).filter((id): id is string => !!id));
  const available = opts.ingredients.filter((i) => i.active && !used.has(i.id));
  const unlinkedPar = activePar.filter((p) => !linked.has(p.id));

  const q = nameKey(query);
  if (!q) {
    const sorted = [...available].sort(
      (a, b) => (a.category ?? "~").localeCompare(b.category ?? "~") || a.name.localeCompare(b.name),
    );
    return { ingredients: sorted, parItems: [], moreIngredients: 0, moreParItems: 0, exact: false, alreadyInRecipe: null };
  }

  const rank = <T extends { name: string }>(list: T[], score: (x: T) => number | null) =>
    list
      .map((x) => ({ x, s: score(x) }))
      .filter((r): r is { x: T; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s || a.x.name.localeCompare(b.x.name))
      .map((r) => r.x);

  const ingredients = rank(available, (i) => {
    const par = i.par_item_id ? parById.get(i.par_item_id) : undefined;
    return matchScore(query, i.name, [
      { text: i.category, weight: 0.6 },
      { text: par?.section, weight: 0.6 },
      { text: par?.area, weight: 0.5 },
    ]);
  });
  const parItems = rank(unlinkedPar, (p) =>
    matchScore(query, p.name, [
      { text: p.section, weight: 0.6 },
      { text: p.area, weight: 0.5 },
    ]),
  );

  const inRecipe = opts.ingredients.find((i) => i.active && used.has(i.id) && nameKey(i.name) === q);
  const exact =
    !!inRecipe || available.some((i) => nameKey(i.name) === q) || unlinkedPar.some((p) => nameKey(p.name) === q);

  return {
    ingredients: ingredients.slice(0, limit),
    parItems: parItems.slice(0, limit),
    moreIngredients: Math.max(0, ingredients.length - limit),
    moreParItems: Math.max(0, parItems.length - limit),
    exact,
    alreadyInRecipe: inRecipe?.name ?? null,
  };
}

// ---------- guesses for a new ingredient ----------

const COUNT_WORDS = new Set([
  "bag", "bags", "cup", "cups", "bun", "buns", "box", "boxes", "sleeve", "sleeves", "lid", "lids",
  "straw", "straws", "stick", "sticks", "can", "cans", "napkin", "napkins", "tray", "trays",
  "boat", "boats", "plate", "plates", "bowl", "bowls", "wrapper", "wrappers", "pick", "picks",
]);

// Recipes measure most things in ounces. A name that's a thing you hand
// over one at a time (a paper bag, a cup, a bun, a can) is counted.
export function guessUnit(name: string): IngredientUnit {
  return words(name).some((w) => COUNT_WORDS.has(w)) ? "count" : "oz";
}

const FILLER = new Set(["the", "and", "of", "a", "an", "with", "for", "in", "on", "oz", "ml", "lb", "lbs", "ct", "gal"]);

// "syrups" and "syrup" are the same word here.
function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

function keyWords(text: string | null | undefined): string[] {
  return words(text)
    .filter((w) => !FILLER.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

function sameWord(a: string, b: string): number {
  if (a === b) return 1;
  const typos = allowedTypos(Math.min(a.length, b.length));
  return typos > 0 && editDistance(a, b, typos) <= typos ? 0.8 : 0;
}

// Words that show up in lots of names ("vanilla", "hot") say less about
// where something goes than a rare one ("torani").
function rarity(list: string[][]): (w: string) => number {
  const df = new Map<string, number>();
  for (const ws of list) for (const w of new Set(ws)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = list.length;
  return (w: string) => {
    let count = df.get(w) ?? 0;
    if (count === 0) for (const [k, c] of df) if (sameWord(w, k) > 0) count = Math.max(count, c);
    return Math.log(1 + n / Math.max(1, count));
  };
}

// A section named for what the thing is ("Syrups" for "Torani vanilla
// syrup") counts about as much as sharing a rare word with a line in it.
const SECTION_POINTS = 5;
const AREA_POINTS = 1;

export interface ParSuggestion {
  // The par line it's most like ("Torani coconut").
  like: ParItemRef;
  area: string;
  section: string | null;
  unit: string | null;
  source: string | null;
}

// Where a new ingredient most likely goes on the par sheet, copied from the
// most similar line already there: "Torani vanilla syrup" → next to
// "Torani coconut", in Coffee › Syrups, by the bottle, from Finicky Fox.
// Null when nothing on the sheet is anything like it.
export function suggestParPlacement(name: string, parItems: ParItemRef[]): ParSuggestion | null {
  const active = parItems.filter((p) => p.active);
  const mine = [...new Set(keyWords(name))];
  if (mine.length === 0 || active.length === 0) return null;
  const itemWords = active.map((p) => keyWords(p.name));
  const weight = rarity(itemWords);

  let best: ParItemRef | null = null;
  let bestScore = 0;
  let bestHits = 0;
  for (let idx = 0; idx < active.length; idx++) {
    const p = active[idx];
    const section = keyWords(p.section);
    const area = keyWords(p.area);
    let score = 0;
    let hits = 0;
    for (const w of mine) {
      const inName = Math.max(0, ...itemWords[idx].map((t) => sameWord(w, t)));
      if (inName > 0) {
        score += inName * weight(w);
        hits++;
      }
      if (section.some((s) => sameWord(w, s) > 0)) score += SECTION_POINTS;
      else if (area.some((a) => sameWord(w, a) > 0)) score += AREA_POINTS;
    }
    // Ties go to the line sharing more words, then to the first one.
    if (score > bestScore || (score > 0 && score === bestScore && hits > bestHits)) {
      best = p;
      bestScore = score;
      bestHits = hits;
    }
  }
  if (!best || bestScore < 2) return null;
  // The unit without the other product's details: "bags (12.5 lb)" → "bags".
  const unit = best.unit?.replace(/\s*\(.*\)\s*$/, "").trim() || null;
  return { like: best, area: best.area, section: best.section, unit, source: best.source };
}

// A category for a new ingredient: the par section it's going into
// ("Syrups", "Popcorn"), or failing that the category of the most similar
// ingredient we already have.
export function suggestCategory(name: string, ingredients: Ingredient[], par: ParSuggestion | null): string {
  if (par?.section) return par.section;
  const mine = [...new Set(keyWords(name))];
  const withCategory = ingredients.filter((i) => i.category);
  if (mine.length === 0 || withCategory.length === 0) return "";
  const theirWords = withCategory.map((i) => keyWords(i.name));
  const weight = rarity(theirWords);
  let bestScore = 0;
  let category = "";
  for (let idx = 0; idx < withCategory.length; idx++) {
    let score = 0;
    for (const w of mine) score += Math.max(0, ...theirWords[idx].map((t) => sameWord(w, t))) * weight(w);
    if (score > bestScore) {
      bestScore = score;
      category = withCategory[idx].category ?? "";
    }
  }
  return bestScore >= 1 ? category : "";
}
