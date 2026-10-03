import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cents, isRewardLine, ownerLinePrice, ownerOrderTotals, recipeCost, type OwnerBook, type OwnerPricing } from "@/lib/register-totals";
import { modifierPrice, type Group } from "@/lib/register-sale-checks";

// The owner rate on the server (the math is in lib/register-totals.ts, with
// what it is and why): who gets it, what each menu item cost, and an owner
// order priced from the database alone. The register shows the owner
// prices from the same math, but the server never takes its word for them:
// completeOwnerTabOrder (pos/actions.ts) prices the order here again and
// refuses it if the two differ.

export interface OwnerPerson {
  id: string;
  name: string;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// Who gets the owner rate: active staff ticked on Back office -> Owner tab
// (employees.owner_rate). A tick on the person, not a role. null: the
// column isn't there yet (20261003060000_owner_tab.sql) or the read failed.
export async function ownerRatePeople(): Promise<OwnerPerson[] | null> {
  const { data, error } = await createAdminClient().from("employees").select("id, name, role").eq("active", true).eq("owner_rate", true).order("name");
  if (error || !data) return null;
  return (data as { id: string; name: string; role: string }[]).filter((e) => e.role !== "display").map((e) => ({ id: e.id, name: e.name }));
}

type RecipeRow = { menu_item_id: string; lines: { ingredient_id: string; quantity: number }[] | null };

// Every menu item's price and what its recipe cost (null: no recipe, or an
// ingredient in it with no cost). The menu is a few hundred items at most.
export async function ownerCostBook(itemIds?: string[]): Promise<OwnerBook> {
  const db = createAdminClient();
  const items = itemIds ? db.from("menu_items").select("id, price").in("id", itemIds) : db.from("menu_items").select("id, price");
  const recipes = itemIds
    ? db.from("recipes").select("menu_item_id, lines:recipe_ingredients(ingredient_id, quantity)").in("menu_item_id", itemIds)
    : db.from("recipes").select("menu_item_id, lines:recipe_ingredients(ingredient_id, quantity)");
  const [itemRes, recipeRes, ingredientRes] = await Promise.all([items, recipes, db.from("ingredients").select("id, unit_cost")]);
  for (const r of [itemRes, recipeRes, ingredientRes]) if (r.error) throw new Error(r.error.message);
  const unitCost = new Map(((ingredientRes.data ?? []) as { id: string; unit_cost: number | null }[]).map((i) => [i.id, i.unit_cost === null ? null : Number(i.unit_cost)]));
  const costByItem = new Map<string, number | null>();
  for (const r of (recipeRes.data ?? []) as unknown as RecipeRow[]) {
    costByItem.set(r.menu_item_id, recipeCost((r.lines ?? []).map((l) => ({ ingredientId: l.ingredient_id, quantity: Number(l.quantity), unitCost: unitCost.get(l.ingredient_id) }))));
  }
  const book: OwnerBook = {};
  for (const i of (itemRes.data ?? []) as { id: string; price: number }[]) book[i.id] = { price: Number(i.price), cost: costByItem.get(i.id) ?? null };
  return book;
}

// A line as the register sends it (pos/actions.ts CheckoutLine).
export interface OwnerSaleLine {
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: string[];
  is_alcohol: boolean;
  screening_id?: string | null;
}

// A line as it's saved: the owner price, the menu price it replaced, and
// how it was priced.
export interface OwnerPricedLine extends OwnerSaleLine {
  menu_unit_price: number;
  owner_pricing: OwnerPricing;
}

export type OwnerPriced =
  | { ok: true; lines: OwnerPricedLine[]; totals: { subtotal: number; tax: number; total: number }; menuValue: number }
  | { ok: false; problems: string[] };

type ItemRow = { id: string; name: string; price: number; is_alcohol: boolean };

// An owner order, priced from the database: each line's menu price (the
// item's price and its options, or the showing's ticket price), then the
// owner price from that and the recipe. Anything that can't be priced from
// the database is a problem, and the order isn't saved: a custom item is
// the only price taken as rung (there's nothing to check it against), and
// it's charged in full.
export async function priceOwnerSale(lines: OwnerSaleLine[]): Promise<OwnerPriced> {
  const db = createAdminClient();
  const problems: string[] = [];
  const itemIds = [...new Set(lines.filter((l) => l.menu_item_id && !l.screening_id).map((l) => l.menu_item_id as string))];
  const screeningIds = [...new Set(lines.filter((l) => l.screening_id).map((l) => l.screening_id as string))];
  const none = Promise.resolve({ data: [] as never[], error: null });
  const [items, groups, screenings] = await Promise.all([
    itemIds.length ? db.from("menu_items").select("id, name, price, is_alcohol").in("id", itemIds) : none,
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
  const itemById = new Map(((items.data ?? []) as ItemRow[]).map((i) => [i.id, i]));
  const groupsByItem = new Map<string, Group[]>();
  for (const g of (groups.data ?? []) as unknown as Group[]) groupsByItem.set(g.item_id, [...(groupsByItem.get(g.item_id) ?? []), g]);
  const ticketPrice = new Map(((screenings.data ?? []) as { id: string; ticket_price: number }[]).map((s) => [s.id, Number(s.ticket_price)]));

  const priced: OwnerPricedLine[] = [];
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) problems.push(`"${l.name}" has a quantity of ${l.quantity}.`);
    let menu: number;
    let isAlcohol = !!l.is_alcohol;
    if (l.screening_id) {
      const price = ticketPrice.get(l.screening_id);
      if (price === undefined) {
        problems.push(`"${l.name}": that showing isn't on the schedule.`);
        continue;
      }
      // A free Insiders+ seat is a member perk, and member perks don't go
      // with the owner rate.
      if (Number(l.unit_price) === 0 && price > 0) {
        problems.push(`"${l.name}" is a free Insiders+ ticket, and member perks don't go on the owner tab. Take it off and ring the ticket at its price.`);
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
      const mods = modifierPrice(itemGroups, l.modifiers ?? []);
      if ("unknown" in mods) {
        problems.push(`"${l.name}": the option "${mods.unknown}" isn't on the menu anymore. Ring it again.`);
        continue;
      }
      if ("ambiguous" in mods) {
        problems.push(`"${l.name}": two of its options are called "${mods.ambiguous}", so its price can't be worked out. Fix the names on the Menu page.`);
        continue;
      }
      for (const g of itemGroups) {
        if (g.must_choose && (g.type ?? "single") === "single" && !g.options.some((o) => (l.modifiers ?? []).includes(o.name))) {
          problems.push(`"${l.name}": nothing was picked for "${g.label ?? "a pick-one question"}".`);
        }
      }
      menu = Number(item.price) + mods.extra;
      // What the menu says, whatever the register sent (it decides the
      // report's Alcohol line and the bar's usage).
      isAlcohol = !!item.is_alcohol;
    } else if (isRewardLine({ menu_item_id: null, screening_id: null, name: String(l.name ?? ""), unit_price: Number(l.unit_price) })) {
      // A badge reward is a member's perk, and member perks don't go with
      // the owner rate.
      problems.push(`"${l.name}" is a member's badge reward, and member perks don't go on the owner tab. Take it off the order (Undo it on the member).`);
      continue;
    } else {
      // A custom item: taken at its rung price (there's nothing to check it against).
      menu = Number(l.unit_price);
      if (!(menu >= 0) || !Number.isFinite(menu)) {
        problems.push(`The custom item "${l.name}" has a price that isn't right.`);
        continue;
      }
    }
    const owner = ownerLinePrice({ menuItemId: l.menu_item_id, screeningId: l.screening_id, unit: menu }, l.menu_item_id && !l.screening_id ? book[l.menu_item_id] : null);
    priced.push({
      menu_item_id: l.menu_item_id,
      name: String(l.name ?? "").slice(0, 200),
      unit_price: owner.unit,
      quantity: qty,
      modifiers: Array.isArray(l.modifiers) ? l.modifiers.map(String) : [],
      is_alcohol: isAlcohol,
      screening_id: l.screening_id ?? null,
      menu_unit_price: cents(menu),
      owner_pricing: owner.how,
    });
  }
  if (problems.length) return { ok: false, problems };
  const t = ownerOrderTotals(priced.map((l) => ({ unit: l.unit_price, qty: l.quantity })));
  const menuValue = cents(priced.reduce((s, l) => s + l.menu_unit_price * l.quantity, 0));
  return { ok: true, lines: priced, totals: { subtotal: t.subtotal, tax: t.tax, total: t.total }, menuValue };
}
