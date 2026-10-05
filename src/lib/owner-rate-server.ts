import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cents, isRewardLine, ownerLinePrice, ownerOffMenuPrice, ownerOrderTotals, recipeCost, type OwnerBook, type OwnerPricing } from "@/lib/register-totals";
import { doubleContext, menuLinePrice, type Group } from "@/lib/register-sale-checks";
import { bookRecipesFor, customIngredientsFor } from "@/lib/data/barBook";
import { bookRecipeIdOf, drinkCost, type DrinkCost } from "@/lib/bar/pricing";
import { cleanCustomRecipe, type CustomRecipeLine } from "@/lib/bar/match";
import { DOUBLE, isServeMod } from "@/lib/bar/double";

// The owner rate on the server (the math is in lib/register-totals.ts, with
// what it is and why): who gets it, what each menu item cost, and an owner
// order priced from the database alone. The register shows the server's
// prices (quoteOwnerRate in pos/owner-rate-actions.ts), and completeOrder in
// pos/actions.ts prices it here again: the register's word is never taken
// for a price.

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// An owner whose member account can carry the owner rate: an active
// employee with role owner and the owner rate on (Back office -> Owner
// rate), linked to the member account that shares their login
// (auth_user_id, the same link Staff logins uses).
export interface OwnerMember {
  memberId: string;
  employeeId: string;
  firstName: string;
}

// Every such owner's member account (or just this one). null: the
// owner_rate column isn't there yet (20261003060000_owner_tab.sql) or the
// read failed.
export async function ownerMembers(memberId?: string): Promise<OwnerMember[] | null> {
  const db = createAdminClient();
  const { data: staff, error } = await db.from("employees").select("id, name, auth_user_id").eq("active", true).eq("role", "owner").eq("owner_rate", true);
  if (error || !staff) return null;
  const byAuth = new Map((staff as { id: string; name: string; auth_user_id: string | null }[]).filter((e) => e.auth_user_id).map((e) => [e.auth_user_id as string, e]));
  if (!byAuth.size) return [];
  let q = db.from("members").select("id, auth_user_id").in("auth_user_id", [...byAuth.keys()]).is("erased_at", null);
  if (memberId) q = q.eq("id", memberId);
  const { data: members, error: memberErr } = await q;
  if (memberErr || !members) return null;
  return (members as { id: string; auth_user_id: string }[]).flatMap((m) => {
    const e = byAuth.get(m.auth_user_id);
    return e ? [{ memberId: m.id, employeeId: e.id, firstName: firstName(e.name) }] : [];
  });
}

// The owner whose member account this is, if it carries the owner rate.
// null: not an owner's account; undefined: it couldn't be read.
export async function ownerForMember(memberId: string | null | undefined): Promise<OwnerMember | null | undefined> {
  if (!memberId) return null;
  const all = await ownerMembers(memberId);
  if (all === null) return undefined;
  return all.find((o) => o.memberId === memberId) ?? null;
}

// "*": cost_complete comes with the owner tab's migration; without it,
// nothing is at cost.
type RecipeRow = { menu_item_id: string; cost_complete?: boolean | null; lines: { ingredient_id: string; quantity: number }[] | null };

async function recipesAndCosts(itemIds?: string[]) {
  const db = createAdminClient();
  const recipes = itemIds
    ? db.from("recipes").select("*, lines:recipe_ingredients(ingredient_id, quantity)").in("menu_item_id", itemIds)
    : db.from("recipes").select("*, lines:recipe_ingredients(ingredient_id, quantity)");
  const [recipeRes, ingredientRes] = await Promise.all([recipes, db.from("ingredients").select("id, name, unit_cost")]);
  for (const r of [recipeRes, ingredientRes]) if (r.error) throw new Error(r.error.message);
  const ingredients = new Map(((ingredientRes.data ?? []) as { id: string; name: string; unit_cost: number | null }[]).map((i) => [i.id, i]));
  return { recipes: (recipeRes.data ?? []) as unknown as RecipeRow[], ingredients };
}

// What a recipe cost, whether a manager has said its cost is complete, and
// which ingredients have no cost.
function recipeFacts(r: RecipeRow | undefined, ingredients: Map<string, { name: string; unit_cost: number | null }>) {
  const lines = r?.lines ?? [];
  const cost = recipeCost(lines.map((l) => ({ ingredientId: l.ingredient_id, quantity: Number(l.quantity), unitCost: ingredients.get(l.ingredient_id)?.unit_cost ?? null })));
  const missing = lines.filter((l) => ingredients.get(l.ingredient_id)?.unit_cost === null || ingredients.get(l.ingredient_id)?.unit_cost === undefined).map((l) => ingredients.get(l.ingredient_id)?.name ?? "an ingredient");
  return { cost, complete: r?.cost_complete === true, lines: lines.length, missing };
}

// Every menu item's price and what it cost: the recipe's cost only when a
// manager ticked "Recipe cost is complete" on Menu -> Recipe and every
// ingredient has a cost; otherwise null (half price). Nothing is ticked to
// start with, so the owners pay more, never less, until someone checks.
export async function ownerCostBook(itemIds?: string[]): Promise<OwnerBook> {
  const db = createAdminClient();
  const items = itemIds ? db.from("menu_items").select("id, price").in("id", itemIds) : db.from("menu_items").select("id, price");
  const [itemRes, { recipes, ingredients }] = await Promise.all([items, recipesAndCosts(itemIds)]);
  if (itemRes.error) throw new Error(itemRes.error.message);
  const byItem = new Map(recipes.map((r) => [r.menu_item_id, r]));
  const book: OwnerBook = {};
  for (const i of (itemRes.data ?? []) as { id: string; price: number }[]) {
    const f = recipeFacts(byItem.get(i.id), ingredients);
    book[i.id] = { price: Number(i.price), cost: f.complete ? f.cost : null };
  }
  return book;
}

// A line as the register sends it (pos/actions.ts CheckoutLine): unit_price
// is its menu price each, as it was rung.
export interface OwnerSaleLine {
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: string[];
  is_alcohol: boolean;
  screening_id?: string | null;
  // A Bar Book drink rung off the menu, or a custom drink with what's in it
  // (pos/actions.ts CheckoutLine): kept only when the server finds them real.
  recipe_id?: string | null;
  custom_recipe?: CustomRecipeLine[] | null;
}

// A line as it's saved: unit_price is the owner price; menu_unit_price the
// menu price it replaced (today's); and how it was priced.
export interface OwnerPricedLine extends OwnerSaleLine {
  menu_unit_price: number;
  owner_pricing: OwnerPricing;
}

export type OwnerPriced =
  | { ok: true; lines: OwnerPricedLine[]; totals: { subtotal: number; tax: number; total: number }; menuValue: number }
  | { ok: false; problems: string[] };

type ItemRow = { id: string; name: string; price: number; is_alcohol: boolean; category_id: string };

// An owner order, priced from the database: each line's menu price today
// (the item's price and its options, or the showing's ticket price), then
// the owner price from that and the recipe. Anything that can't be priced
// from the database is a problem, and it isn't sold at the owner rate: a custom item
// is the only price taken as rung (there's nothing to check it against),
// and it's charged in full. Whether the line was rung at today's price is
// for the caller to check (ownerSaleProblems).
export async function priceOwnerSale(lines: OwnerSaleLine[]): Promise<OwnerPriced> {
  const db = createAdminClient();
  const problems: string[] = [];
  const itemIds = [...new Set(lines.filter((l) => l.menu_item_id && !l.screening_id).map((l) => l.menu_item_id as string))];
  const screeningIds = [...new Set(lines.filter((l) => l.screening_id).map((l) => l.screening_id as string))];
  const none = Promise.resolve({ data: [] as never[], error: null });
  const [items, groups, screenings] = await Promise.all([
    itemIds.length ? db.from("menu_items").select("id, name, price, is_alcohol, category_id").in("id", itemIds) : none,
    // "*": must_choose comes with its own migration.
    itemIds.length ? db.from("menu_modifier_groups").select("*, options:menu_modifier_options(name, price_delta)").in("item_id", itemIds) : none,
    screeningIds.length ? db.from("screenings").select("id, ticket_price").in("id", screeningIds) : none,
  ]);
  for (const r of [items, groups, screenings]) if (r.error) return { ok: false, problems: ["The menu couldn't be read. Try again."] };
  let book: OwnerBook;
  try {
    book = itemIds.length ? await ownerCostBook(itemIds) : {};
  } catch {
    return { ok: false, problems: ["The menu's costs couldn't be read. Try again."] };
  }
  // The Bar Book drinks and custom drinks on it, with what they cost; the
  // Prices sheet and recipes for any Double, Neat or On the rocks.
  let doubles: Awaited<ReturnType<typeof doubleContext>>;
  let bookRecipes: Awaited<ReturnType<typeof bookRecipesFor>>;
  let customIngredients: Awaited<ReturnType<typeof customIngredientsFor>>;
  try {
    [bookRecipes, customIngredients, doubles] = await Promise.all([
      bookRecipesFor(lines),
      customIngredientsFor(lines),
      doubleContext(db, lines.filter((l) => l.menu_item_id && !l.screening_id && (l.modifiers ?? []).some((m) => m === DOUBLE || isServeMod(m))).map((l) => l.menu_item_id as string)),
    ]);
  } catch {
    return { ok: false, problems: ["The menu's prices couldn't be read. Try again."] };
  }
  const itemById = new Map(((items.data ?? []) as ItemRow[]).map((i) => [i.id, i]));
  const groupsByItem = new Map<string, Group[]>();
  for (const g of (groups.data ?? []) as unknown as Group[]) groupsByItem.set(g.item_id, [...(groupsByItem.get(g.item_id) ?? []), g]);
  const ticketPrice = new Map(((screenings.data ?? []) as { id: string; ticket_price: number }[]).map((s) => [s.id, Number(s.ticket_price)]));

  const priced: OwnerPricedLine[] = [];
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) problems.push(`"${l.name}" has a quantity of ${l.quantity}.`);
    // Each option once: the register never sends one twice.
    const mods = [...new Set((Array.isArray(l.modifiers) ? l.modifiers : []).map(String))];
    let menu: number;
    let isAlcohol = !!l.is_alcohol;
    let offMenu: { unit: number; how: OwnerPricing; recipe_id: string | null; custom_recipe: CustomRecipeLine[] | null } | null = null;
    if (l.screening_id) {
      const price = ticketPrice.get(l.screening_id);
      if (price === undefined) {
        problems.push(`"${l.name}": that showing isn't on the schedule.`);
        continue;
      }
      // A free Insiders+ seat is a member perk, and member perks don't go
      // with the owner rate.
      if (Number(l.unit_price) === 0 && price > 0) {
        problems.push(`"${l.name}" is a free Insiders+ ticket, and member perks don't go with the owner rate. Take it off and ring the ticket at its price.`);
        continue;
      }
      menu = price;
    } else if (l.menu_item_id) {
      const item = itemById.get(l.menu_item_id);
      if (!item) {
        problems.push(`"${l.name}" isn't on the menu anymore. Take it off the order and ring it again.`);
        continue;
      }
      const itemGroups = groupsByItem.get(item.id) ?? [];
      // A "pick one" question takes one answer.
      const twice = itemGroups.find((g) => (g.type ?? "single") === "single" && g.options.filter((o) => mods.includes(o.name)).length > 1);
      if (twice) {
        problems.push(`"${l.name}": "${twice.label ?? "a pick-one question"}" takes one answer. Take it off the order and ring it again.`);
        continue;
      }
      // Options, Double, Neat and On the rocks, priced like any sale; the
      // owner rate takes half of whatever they add (ownerLinePrice).
      const mp = menuLinePrice(item, itemGroups, mods, doubles);
      if ("error" in mp) {
        problems.push(`"${l.name}" ${mp.error}. Take it off the order and ring it again.`);
        continue;
      }
      for (const g of itemGroups) {
        if (g.must_choose && (g.type ?? "single") === "single" && !g.options.some((o) => mods.includes(o.name))) {
          problems.push(`"${l.name}": nothing was picked for "${g.label ?? "a pick-one question"}".`);
        }
      }
      // Never below nothing, however the options add up.
      menu = Math.max(0, mp.unit);
      // What the menu says, whatever the register sent (it decides the
      // report's Alcohol line and the bar's usage).
      isAlcohol = !!item.is_alcohol;
    } else if (isRewardLine({ menu_item_id: null, screening_id: null, name: String(l.name ?? ""), unit_price: Number(l.unit_price) })) {
      // A badge reward is a member's perk, and member perks don't go with
      // the owner rate.
      problems.push(`"${l.name}" is a member's badge reward, and member perks don't go with the owner rate. Take it off the order (Undo it on the member).`);
      continue;
    } else {
      // A Bar Book drink or a custom drink with what's in it: cost + 10% when
      // every ingredient has a cost, else half. A plain custom item is
      // taken at its rung price (there's nothing to check it against) and
      // charged in full.
      menu = Number(l.unit_price);
      if (!(menu >= 0) || !Number.isFinite(menu)) {
        problems.push(`The custom item "${l.name}" has a price that isn't right.`);
        continue;
      }
      const recipeId = bookRecipeIdOf(l, bookRecipes);
      const custom = recipeId ? null : cleanCustomRecipe(l, customIngredients);
      let cost: DrinkCost | null = null;
      if (recipeId) cost = bookRecipes.get(recipeId)?.cost ?? null;
      else if (custom) cost = drinkCost(custom.map((c) => ({ name: c.name ?? "?", quantity: c.quantity, unitCost: customIngredients.get(c.ingredient_id)?.unitCost ?? null })));
      if (cost) {
        offMenu = { ...ownerOffMenuPrice(menu, cost, mods.includes(DOUBLE)), recipe_id: recipeId, custom_recipe: custom };
      }
    }
    const owner = offMenu ?? ownerLinePrice({ menuItemId: l.menu_item_id, screeningId: l.screening_id, unit: menu }, l.menu_item_id && !l.screening_id ? book[l.menu_item_id] : null);
    priced.push({
      menu_item_id: l.menu_item_id,
      name: String(l.name ?? "").slice(0, 200),
      unit_price: owner.unit,
      quantity: qty,
      modifiers: mods,
      is_alcohol: isAlcohol,
      screening_id: l.screening_id ?? null,
      menu_unit_price: cents(menu),
      owner_pricing: owner.how,
      // Kept only for a real Bar Book drink or custom list.
      ...(offMenu?.recipe_id ? { recipe_id: offMenu.recipe_id } : {}),
      ...(offMenu?.custom_recipe ? { custom_recipe: offMenu.custom_recipe } : {}),
    });
  }
  if (problems.length) return { ok: false, problems };
  const t = ownerOrderTotals(priced.map((l) => ({ unit: l.unit_price, qty: l.quantity })));
  const menuValue = cents(priced.reduce((s, l) => s + l.menu_unit_price * l.quantity, 0));
  return { ok: true, lines: priced, totals: { subtotal: t.subtotal, tax: t.tax, total: t.total }, menuValue };
}

// Back office -> Owner rate's "Prices": every item on the menu, its price,
// what its recipe costs, whether that cost is confirmed complete, and what
// an owner pays for it, so "cost + 10%" can be checked.
export interface OwnerPriceRow {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number | null; // the recipe's cost (null: no recipe, or an ingredient with no cost)
  complete: boolean; // "Recipe cost is complete" ticked
  missing: string[]; // ingredients with no cost
  hasRecipe: boolean;
  owner: number; // what an owner pays, before options
  how: OwnerPricing;
}

export async function ownerPriceList(): Promise<OwnerPriceRow[] | null> {
  const db = createAdminClient();
  try {
    const [items, cats, { recipes, ingredients }] = await Promise.all([
      db.from("menu_items").select("id, name, price, category_id, active").eq("active", true).order("sort_order"),
      db.from("menu_categories").select("id, label, sort_order").order("sort_order"),
      recipesAndCosts(),
    ]);
    if (items.error || cats.error) return null;
    const catLabel = new Map(((cats.data ?? []) as { id: string; label: string }[]).map((c) => [c.id, c.label]));
    const catOrder = new Map(((cats.data ?? []) as { id: string; sort_order: number }[]).map((c, i) => [c.id, i]));
    const byItem = new Map(recipes.map((r) => [r.menu_item_id, r]));
    const rows = ((items.data ?? []) as { id: string; name: string; price: number; category_id: string }[])
      .sort((a, b) => (catOrder.get(a.category_id) ?? 999) - (catOrder.get(b.category_id) ?? 999))
      .map((i): OwnerPriceRow => {
        const r = byItem.get(i.id);
        const f = recipeFacts(r, ingredients);
        const owner = ownerLinePrice({ menuItemId: i.id, unit: Number(i.price) }, { price: Number(i.price), cost: f.complete ? f.cost : null });
        return {
          id: i.id,
          name: i.name,
          category: catLabel.get(i.category_id) ?? "",
          price: Number(i.price),
          cost: f.cost,
          complete: f.complete && f.cost !== null,
          missing: f.missing,
          hasRecipe: f.lines > 0,
          owner: owner.unit,
          how: owner.how,
        };
      });
    return rows;
  } catch {
    return null;
  }
}
