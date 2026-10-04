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
