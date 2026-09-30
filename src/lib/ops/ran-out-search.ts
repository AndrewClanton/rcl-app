// Search for the register's "Ran out" sheet: what ran out (the par sheet)
// and which menu items to stop. Pure functions (no React, no database), so
// scripts/check-ran-out-db.mjs can run them.

import { editDistance, matchScore, words } from "@/lib/ingredient-search";
import type { RanOutOptions } from "./shared";

type ParOpt = RanOutOptions["parItems"][number];
type MenuOpt = RanOutOptions["menu"][number];

// Par sheet lines matching what's typed, best first: "hot dog b" or "buns"
// finds Hot dog buns. Section and sheet count too ("hot dogs" finds both
// lines in Concessions › Hot dogs); a small typo is forgiven.
export function searchPar(query: string, items: ParOpt[], limit = 8): ParOpt[] {
  return items
    .map((p) => ({ p, s: matchScore(query, p.name, [{ text: p.section, weight: 0.6 }, { text: p.area, weight: 0.5 }]) }))
    .filter((x): x is { p: ParOpt; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

export function searchMenu(query: string, menu: MenuOpt[], limit = 12): MenuOpt[] {
  return menu
    .map((m) => ({ m, s: matchScore(query, m.name, [{ text: m.category, weight: 0.5 }]) }))
    .filter((x): x is { m: MenuOpt; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}

// Words that say how it's packed, not what it is.
const SKIP = new Set([
  "the", "and", "of", "with", "for", "oz", "ml", "lb", "lbs", "ct", "gal", "bag", "bags", "box", "boxes", "case", "cases",
  "pack", "packs", "sleeve", "sleeves", "bottle", "bottles", "can", "cans", "jar", "jars", "each", "large", "small",
]);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const keyWords = (text: string | null | undefined) => [...new Set(words(text).filter((w) => w.length >= 3 && !SKIP.has(w)).map(stem))];
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b, 1) <= 1);

// What a sold thing is made around: a hot dog needs its bun, a pizza its
// crust, popcorn its kernels. Anything else in the par line's name (sauce,
// cheese, oil, bags, cups) makes it a different thing, so it isn't matched.
const PARTS = new Set(["bun", "crust", "dough", "kernel", "shell", "tortilla", "patty", "pattie", "roll", "cone", "wrap"]);
// A size or serving, not what the item is: "Pizza (slice)", "Large popcorn".
const SERVING = new Set(["small", "medium", "large", "regular", "personal", "kid", "kids", "slice", "whole", "single", "double", "jumbo", "mini"]);
const nameWords = (text: string) => [...new Set(words(text).map(stem))];

// Menu items that plainly are what ran out, or are made around it, sure
// enough to start ticked: the item's name, less the size ("Hot dog
// (regular)" → hot dog), is all in the par line's name, and whatever else
// the par line says is only the part it's made with.
//   Hot dogs, Hot dog buns → Hot dog (regular)
//   Pizza crust → Pizza (slice), Pizza (large)
//   Popcorn kernels → Popcorn (small), (personal), (large)
// but Pizza sauce, Popping oil or Cheese match nothing. The par line's
// section counts too ("Buns" in Hot dogs), a small typo is forgiven, and
// every match can still be unticked.
export function strongMenuMatches(what: string, section: string | null, menu: MenuOpt[]): MenuOpt[] {
  const tries = [nameWords(what), ...(section ? [nameWords(`${section} ${what}`)] : [])];
  return menu.filter((m) => {
    const base = nameWords(m.name.replace(/\([^)]*\)/g, " ")).filter((w) => !SERVING.has(w));
    if (base.length === 0) return false;
    return tries.some((mine) => {
      const used = new Set<string>();
      for (const b of base) {
        const hit = mine.find((w) => !used.has(w) && sameWord(w, b));
        if (!hit) return false;
        used.add(hit);
      }
      return mine.every((w) => used.has(w) || PARTS.has(w));
    });
  });
}

// Menu items that look like they need what ran out, by name: "Hot dog buns"
// (Concessions › Hot dogs) → "Hot dog (regular)". Offered, not ticked: two
// words in common, or the item's only word ("Popcorn" for popcorn kernels).
export function suggestMenuItems(what: string, section: string | null, menu: MenuOpt[], limit = 8): MenuOpt[] {
  const mine = keyWords(`${what} ${section ?? ""}`);
  if (mine.length === 0) return [];
  return menu
    .map((m) => {
      const theirs = keyWords(m.name);
      const hits = theirs.filter((t) => mine.some((w) => sameWord(w, t))).length;
      return { m, hits, n: theirs.length };
    })
    .filter((x) => x.hits >= 2 || (x.hits === 1 && x.n === 1))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.m);
}
