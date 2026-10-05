// Where the bar's menu sits and how its items are drawn. Client-safe: plain
// functions over menu and recipe data, nothing from the server.
import { FAMILY_COLOR, iconSpecFor, tintRgba, type BarSection, type Family, type IconSpec } from "@/lib/bar/icons";

type Named = { key?: string | null; label?: string | null } | null | undefined;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// The register's bar tab: the menu category that holds beer, wine,
// cocktails and shots (key "spirits", shown as Alcohol in Back office).
export function isBarCategory(c: Named): boolean {
  if (!c) return false;
  return ["spirits", "alcohol", "bar", "liquor"].includes(norm(c.key)) || /^(alcohol|bar|spirits|liquor)$/.test(norm(c.label));
}

// Which part of the bar tab a subcategory goes in, by its key or name.
export function barSectionOf(c: Named): BarSection {
  const s = `${norm(c?.key)} ${norm(c?.label)}`;
  if (/beer|draft|\btaps?\b|\bcans?\b|brew/.test(s)) return "beer";
  if (/wine|mead/.test(s)) return "wine";
  if (/shot/.test(s)) return "shots";
  if (/cocktail|mixed/.test(s)) return "cocktails";
  return "other";
}

// A recipe as the register and the display have it (lib/types Recipe).
export interface RecipeLike {
  glassware?: string | null;
  garnish?: string | null;
  garnishes?: readonly string[] | null;
  ice?: string | null;
  ingredients?: readonly { ingredient_name: string; quantity: number; unit?: string | null; family?: string | null; kind?: string | null }[] | null;
}

// A menu item's icon: from its recipe when it has poured ingredients, else
// its section's (a pint for beer, a wine glass, a shot glass, a rocks glass).
export function itemIconSpec(recipe: RecipeLike | null | undefined, section: BarSection): IconSpec {
  if (!recipe || !recipe.ingredients?.length) return iconSpecFor(recipe ? { glassware: recipe.glassware, garnish: recipe.garnish, garnishes: recipe.garnishes, ice: recipe.ice, ingredients: [] } : null, section);
  return iconSpecFor(
    {
      glassware: recipe.glassware,
      garnish: recipe.garnish,
      garnishes: recipe.garnishes,
      ice: recipe.ice,
      ingredients: recipe.ingredients.map((i) => ({ name: i.ingredient_name, quantity: i.quantity, unit: i.unit, family: i.family, kind: i.kind })),
    },
    section,
  );
}

// The CSS custom properties a tinted bar button reads (.bar-tint in
// globals.css): the spirit's color, and plain rgba fallbacks for a browser
// without color-mix(). A drink with no spirit gets a plain card.
export function tintVars(family: Family | null): Record<string, string> {
  if (!family) return { "--sp": "#e3ddc9", "--sp-soft": "rgba(255, 255, 255, 1)", "--sp-line": "rgba(227, 221, 201, 1)" };
  return { "--sp": FAMILY_COLOR[family], "--sp-soft": tintRgba(family, 0.16), "--sp-line": tintRgba(family, 0.5) };
}

// ---------- laying out the Bar tab ----------

// A quick pour's name under its heading: "Draft beer" under BEER is
// "Draft", "Well shot" under SHOTS is "Well", "Glass of wine" is "Glass".
// Only the section's own word at the start or end goes; anything else (or
// a name that is nothing but that word) stays as it is.
export function quickPourName(name: string, section: BarSection): string {
  const word = section === "beer" ? "beers?" : section === "wine" ? "wines?" : section === "shots" ? "shots?" : null;
  if (!word) return name;
  const trimmed = name
    .replace(new RegExp(`\\s+(of\\s+)?${word}$`, "i"), "")
    .replace(new RegExp(`^${word}\\s+`, "i"), "")
    .trim();
  if (!trimmed || trimmed.length === name.trim().length) return name;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export interface GridPlan {
  cols: number;
  rows: number;
  perPage: number; // tiles on a page
  pages: number;
  tileW: number;
  tileH: number;
}

// Smallest a cocktail tile may be: its icon, a two-line name and its price
// at a size staff can read and hit.
export const TILE_MIN_W = 100;
export const TILE_MIN_H = 112;
export const PAGER_H = 48; // the ‹ 1 / 2 › row under the tiles when they page

// How the cocktail tiles fill their box (w × h): columns and rows sized so
// the grid always fills the box edge to edge, with no band left empty under
// it. When everything fits on one page, the arrangement with the fewest
// empty cells and the most nearly square tiles wins (8 tiles in a tall box
// are 2 × 4, 11 are 3 × 4). When they don't fit, the tiles page: the box
// minus the pager row holds as many full-size tiles as it can, and every
// page is laid out the same.
export function gridPlan(w: number, h: number, n: number, gap = 8): GridPlan | null {
  if (!(w > 0) || !(h > 0)) return null;
  const count = Math.max(1, Math.floor(n));
  const options = (height: number) => {
    const list: { cols: number; rows: number; tileW: number; tileH: number; cap: number; shape: number }[] = [];
    for (let cols = 1; cols <= 6; cols++) {
      for (let rows = 1; rows <= 8; rows++) {
        const tileW = (w - gap * (cols - 1)) / cols;
        const tileH = (height - gap * (rows - 1)) / rows;
        if (tileW < TILE_MIN_W || tileH < TILE_MIN_H) continue;
        const aspect = tileH / tileW;
        if (aspect > 2.4 || aspect < 0.42) continue;
        // A little taller than wide suits an icon over a name.
        list.push({ cols, rows, tileW, tileH, cap: cols * rows, shape: Math.abs(Math.log(aspect / 1.05)) });
      }
    }
    return list;
  };
  type Option = ReturnType<typeof options>[number];
  const best = (list: Option[], score: (o: Option) => number) => list.reduce((a, b) => (score(b) < score(a) ? b : a));

  const onePage = options(h).filter((o) => o.cap >= count);
  if (onePage.length) {
    const o = best(onePage, (x) => x.cap - count + 2 * x.shape + (x.cols === 1 ? 3 : 0));
    return { cols: o.cols, rows: o.rows, perPage: o.cap, pages: 1, tileW: o.tileW, tileH: o.tileH };
  }
  const paged = options(h - PAGER_H - gap);
  if (!paged.length) {
    // A box too small for even one tile: one at a time.
    return { cols: 1, rows: 1, perPage: 1, pages: count, tileW: w, tileH: Math.max(TILE_MIN_H, h - PAGER_H - gap) };
  }
  const most = Math.max(...paged.map((o) => o.cap));
  const o = best(
    paged.filter((x) => x.cap === most),
    (x) => x.shape,
  );
  return { cols: o.cols, rows: o.rows, perPage: o.cap, pages: Math.ceil(count / o.cap), tileW: o.tileW, tileH: o.tileH };
}
