import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { cents, registerTotals, type TotalsMember } from "@/lib/register-totals";
import type { MemberTier } from "@/lib/types";
import { hasPlusPerks } from "@/lib/plus-status";
import { coffeeTime } from "@/lib/daily-perk";
import { coffeeDay, dailyCoffeeUse, type DailyCoffeeUse } from "@/lib/daily-perk-server";
import { DOUBLE, DOUBLE_SETTING, hasOwnDouble, isDouble, priceWithDouble, readDoubleSettings, sectionOfCategory, withoutDouble, type DoubleLine, type DoubleSettings } from "@/lib/bar/double";
import { barSectionOf, isBarCategory } from "@/lib/bar/menu";

// The server's own look at a register sale before it's saved, instead of
// taking the register's word for it:
//
// - verifyCardPayment: the card payment really happened, for this amount,
//   on the register. This one decides: a payment that isn't real, didn't go
//   through, belongs to something else, or is for a different amount is
//   refused. If Stripe can't be reached the sale is saved and flagged: the
//   card was already charged, and losing the record is worse.
// - checkSaleTotals: redoes the order's math from menu prices, modifiers,
//   ticket prices, discounts and tax (registerTotals in
//   lib/register-totals.ts, the same function the register uses) and lists
//   anything more than a cent off, a "pick one" question left unanswered,
//   and payments that don't add up to the total plus tip. Log-only unless
//   ENFORCE_REGISTER_TOTALS is on.
// - checkDailyCoffee: an Insiders+ daily coffee on the order is allowed:
//   the member has Insiders+ perks, an item on the order is ticked as a
//   daily coffee, and they haven't had today's. The register is stopped
//   before payment when it isn't (whether or not totals are enforced); a
//   sale that gets through anyway is saved without counting as today's
//   coffee, and its totals check says why.
//
// Anything worth a look lands in register_sale_flags (and the server log,
// prefixed "[register-check]").
//
// Switching to enforce: read the totals_mismatch flags for a few busy
// nights first. Each one would have been a refused sale. Known ways a
// legitimate sale can differ: a menu or ticket price changed while an item
// sat on an open tab (the tab keeps the old price), a modifier renamed or
// removed since it was rung, or a member's points or tier changing between
// attaching them and paying, or a "pick one" question added to an item
// after it was rung, or an item's daily coffee tick changed while it sat on
// an open tab. With enforce on, the register checks before
// the payment screen, so those show a message and nothing is charged; a
// sale whose card was already charged is still saved (and flagged), never
// refused.

const money = (n: number) => `$${n.toFixed(2)}`;
// "Over a cent": figures are rounded to the cent, so this means 2c or more.
const differs = (a: number, b: number) => Math.abs(a - b) > 0.0101;

// ---------- card payments ----------

export type CardCheck =
  // flag: saved, but worth a look (Stripe didn't answer, say).
  | { ok: true; flag?: { reason: string; detail: string } }
  // charged: the card was charged for this sale, so the register keeps
  // the "card WAS charged" warning up.
  | { ok: false; charged: boolean; reason: string; error: string };

const RING_AGAIN = "The sale wasn't saved. Ring it up again and take payment.";

export async function verifyCardPayment(payment: { card: number; stripePaymentIntentId?: string | null }, draftOrderId: string | null): Promise<CardCheck> {
  const id = payment.stripePaymentIntentId || null;
  const cardCents = Math.round((Number(payment.card) || 0) * 100);
  if (!id) {
    if (cardCents > 0) {
      return { ok: false, charged: false, reason: "card_without_payment", error: "Cards are charged on the card reader, and this one wasn't. Nothing was charged and the sale wasn't saved. Take payment again." };
    }
    return { ok: true };
  }
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) return { ok: false, charged: false, reason: "not_a_payment_id", error: `That isn't a card payment from the reader. ${RING_AGAIN}` };

  let pi: Stripe.PaymentIntent;
  try {
    // A few seconds at most: a slow Stripe must not hold up a sale (the
    // library's own default waits over a minute).
    pi = await getStripe().paymentIntents.retrieve(id, {}, { timeout: 6000, maxNetworkRetries: 1 });
  } catch (e) {
    const err = (e ?? {}) as { type?: string; statusCode?: number; code?: string; message?: string };
    // Stripe answered, and there's no such payment.
    if (err.type === "StripeInvalidRequestError" && (err.statusCode === 404 || err.code === "resource_missing")) {
      return { ok: false, charged: false, reason: "payment_not_found", error: `Stripe has no record of that card payment. ${RING_AGAIN}` };
    }
    // Stripe didn't answer (or had its own trouble). As far as the register
    // knows the card is charged, so save the sale and flag it.
    return { ok: true, flag: { reason: "stripe_unreachable", detail: err.message ?? String(e) } };
  }

  if (pi.status !== "succeeded") return { ok: false, charged: false, reason: `payment_${pi.status}`, error: `Stripe says that card payment didn't go through. ${RING_AGAIN}` };
  // The register's own payments: the reader (terminal-actions) and a tab's
  // card on file (tab-card-actions). Not an online ticket or booth payment.
  const source = pi.metadata?.source;
  if (source !== "pos" && source !== "pos-tab") {
    return { ok: false, charged: false, reason: "not_a_register_payment", error: `That card payment wasn't taken on the register, so it can't pay for this sale. ${RING_AGAIN}` };
  }
  // `amount` includes a tip picked on the reader; amount_received is what
  // was taken. For these payments they're the same once it succeeds.
  if (pi.amount_received !== cardCents && pi.amount !== cardCents) {
    return {
      ok: false,
      charged: true,
      reason: "amount_mismatch",
      error: `The card was charged ${money(pi.amount_received / 100)}, but this sale says ${money(cardCents / 100)} on the card, so it wasn't saved. Don't charge the card again: get a manager to check Stripe's Payments list.`,
    };
  }
  if (source === "pos-tab" && pi.metadata?.tab_id !== (draftOrderId ?? undefined)) {
    return { ok: true, flag: { reason: "tab_card_other_tab", detail: `Card on file for tab ${pi.metadata?.tab_id ?? "?"} paid ${draftOrderId ? `tab ${draftOrderId}` : "a walk-up order"}` } };
  }
  return { ok: true };
}

// ---------- the order's math ----------

export interface SaleForCheck {
  memberId: string | null;
  monthlyMember: boolean;
  taxFree: boolean;
  pointsRedeemed: boolean;
  lines: { menu_item_id: string | null; name: string; unit_price: number; quantity: number; modifiers: string[]; is_alcohol: boolean; screening_id?: string | null }[];
  // daily_perk_discount: the Insiders+ daily coffee (missing from a sale
  // rung before it existed, which is the same as none).
  totals: { subtotal: number; daily_perk_discount?: number; tier_discount: number; monthly_discount: number; redemption_discount: number; tax: number; total: number };
  payment?: { cash: number; card: number; voucher?: number };
  tip?: number;
  // The member's points before this sale moved them, for a check that runs
  // after the sale's reward and purchase points have landed (log-only mode):
  // a reward is judged on the balance it was taken from. Left out (or not a
  // number), the member's balance now is used.
  memberPointsBefore?: number | null;
  // The daily coffee's own check (checkDailyCoffee), when it already ran
  // before the sale was saved: once saved, the sale's own coffee would
  // count as "already had today's". Left out, it's checked here.
  dailyCoffee?: CoffeeCheck;
}

type ServerTotals = SaleForCheck["totals"];

export interface TotalsCheck {
  problems: string[]; // one plain sentence per thing that didn't add up
  server: ServerTotals | null; // the server's own figures
  lines: { name: string; sent: number; expected: number; qty: number; note?: string }[];
  member: TotalsMember;
  skipped?: string; // the check itself couldn't run (a database hiccup); nothing was compared
}

const TOTAL_LABELS: [keyof ServerTotals, string][] = [
  ["subtotal", "Subtotal"],
  ["daily_perk_discount", "Insiders+ daily coffee"],
  ["tier_discount", "Member discount"],
  ["monthly_discount", "Monthly member discount"],
  ["redemption_discount", "Points reward"],
  ["tax", "Tax"],
  ["total", "Total"],
];

// ---------- the Insiders+ daily coffee ----------

// reason: one plain sentence for staff (and the flag), with no customer
// details. unchecked: it couldn't be looked up, so it's allowed (the
// database still allows only one a day).
export type CoffeeCheck = { ok: true; unchecked?: string } | { ok: false; reason: string; used?: DailyCoffeeUse };

// Whether the member on a sale can have a free daily coffee on it now.
// Never throws.
export async function checkDailyCoffee(sale: { memberId: string | null; lines: { menu_item_id: string | null; screening_id?: string | null }[] }, date = coffeeDay()): Promise<CoffeeCheck> {
  if (!sale.memberId) return { ok: false, reason: "There's no member on the order." };
  try {
    const supabase = createAdminClient();
    const itemIds = [...new Set(sale.lines.filter((l) => l.menu_item_id && !l.screening_id).map((l) => l.menu_item_id as string))];
    const [memberRow, items, used] = await Promise.all([
      supabase.from("members").select("tier").eq("id", sale.memberId).maybeSingle(),
      // "*": daily_perk is there once its migration is applied.
      itemIds.length ? supabase.from("menu_items").select("*").in("id", itemIds) : Promise.resolve({ data: [] as never[], error: null }),
      dailyCoffeeUse(sale.memberId, date),
    ]);
    const error = memberRow.error ?? items.error;
    if (error) return { ok: true, unchecked: error.message };
    if (!memberRow.data) return { ok: false, reason: "The member on the order wasn't found." };
    if (!hasPlusPerks(memberRow.data as { tier: MemberTier })) return { ok: false, reason: "The member on the order isn't Insiders+." };
    if (!((items.data ?? []) as { daily_perk?: boolean }[]).some((i) => i.daily_perk)) {
      return { ok: false, reason: "Nothing on the order is a daily coffee item (Back office, Menu)." };
    }
    if (used) return { ok: false, reason: `This member already had today's free coffee (order #${used.orderNumber} at ${coffeeTime(used.usedAt)}).`, used };
    return used === undefined ? { ok: true, unchecked: "today's coffee couldn't be looked up" } : { ok: true };
  } catch (e) {
    return { ok: true, unchecked: e instanceof Error ? e.message : String(e) };
  }
}

// Never throws: a hiccup here must not stop a sale.
export async function checkSaleTotals(sale: SaleForCheck): Promise<TotalsCheck> {
  try {
    return await compareTotals(sale);
  } catch (e) {
    return { problems: [], server: null, lines: [], member: null, skipped: e instanceof Error ? e.message : String(e) };
  }
}

// must_choose: a "pick one" question with no default (the $5 Special's
// soda). Read with "*", so a database without that column still checks.
type Group = { item_id: string; label?: string | null; type?: string | null; must_choose?: boolean | null; options: { name: string; price_delta: number }[] };

// What a line's modifiers add to the item's price, found by option name
// (the register saves names, not ids).
function modifierPrice(groups: Group[], mods: string[]): { extra: number } | { unknown: string } | { ambiguous: string } {
  let extra = 0;
  for (const name of mods) {
    const deltas = new Set(groups.flatMap((g) => g.options.filter((o) => o.name === name).map((o) => Number(o.price_delta))));
    if (deltas.size === 0) return { unknown: name };
    if (deltas.size > 1) return { ambiguous: name };
    extra += [...deltas][0];
  }
  return { extra };
}

async function compareTotals(sale: SaleForCheck): Promise<TotalsCheck> {
  const supabase = createAdminClient();
  const itemIds = [...new Set(sale.lines.filter((l) => l.menu_item_id && !l.screening_id).map((l) => l.menu_item_id as string))];
  const screeningIds = [...new Set(sale.lines.filter((l) => l.screening_id).map((l) => l.screening_id as string))];
  const none = Promise.resolve({ data: [] as never[], error: null });

  const [items, groups, screenings, memberRow] = await Promise.all([
    // "*" so the check still runs before the daily coffee's migration adds daily_perk.
    itemIds.length ? supabase.from("menu_items").select("*").in("id", itemIds) : none,
    itemIds.length ? supabase.from("menu_modifier_groups").select("*, options:menu_modifier_options(name, price_delta)").in("item_id", itemIds) : none,
    screeningIds.length ? supabase.from("screenings").select("id, ticket_price").in("id", screeningIds) : none,
    sale.memberId ? supabase.from("members").select("tier, points").eq("id", sale.memberId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [items, groups, screenings, memberRow]) if (r.error) throw new Error(r.error.message);
  // A double ("Double" on an alcohol line, lib/bar/double.ts) is priced from
  // the item's section, its recipe and the double settings, read only when
  // the sale has one.
  const doubles = await doubleContext(
    supabase,
    sale.lines.filter((l) => l.menu_item_id && !l.screening_id && (l.modifiers ?? []).includes(DOUBLE)).map((l) => l.menu_item_id as string),
  );

  const itemById = new Map(((items.data ?? []) as { id: string; price: number; is_alcohol: boolean; category_id: string; daily_perk?: boolean }[]).map((i) => [i.id, i]));
  const groupsByItem = new Map<string, Group[]>();
  for (const g of (groups.data ?? []) as unknown as Group[]) groupsByItem.set(g.item_id, [...(groupsByItem.get(g.item_id) ?? []), g]);
  const ticketPrice = new Map(((screenings.data ?? []) as { id: string; ticket_price: number }[]).map((s) => [s.id, Number(s.ticket_price)]));
  const m = memberRow.data as { tier: MemberTier; points: number } | null;
  const member: TotalsMember = m ? { tier: m.tier, points: typeof sale.memberPointsBefore === "number" ? sale.memberPointsBefore : Number(m.points) } : null;

  const problems: string[] = [];
  if (sale.memberId && !member) problems.push("The member on the order wasn't found.");

  const lines = sale.lines.map((l) => {
    const sent = Number(l.unit_price);
    let expected = sent;
    let note: string | undefined;
    // What a daily coffee takes off this line: its item's menu price, if
    // the item is ticked as a daily coffee.
    let perkBase: number | null = null;
    if (!Number.isInteger(l.quantity) || l.quantity < 1) problems.push(`"${l.name}" has a quantity of ${l.quantity}.`);
    if (l.screening_id) {
      const price = ticketPrice.get(l.screening_id);
      if (price === undefined) problems.push(`"${l.name}": that showing isn't on the schedule.`);
      // A free Insiders+ entry is a $0 ticket for an Insiders+ member.
      else if (!(sent === 0 && member?.tier === "Insiders+")) expected = price;
    } else if (l.menu_item_id) {
      const item = itemById.get(l.menu_item_id);
      if (!item) {
        problems.push(`"${l.name}" isn't on the menu anymore, so its price couldn't be checked.`);
      } else {
        if (item.daily_perk) perkBase = Number(item.price);
        const itemGroups = groupsByItem.get(item.id) ?? [];
        // Our Double isn't a menu option (unless the item has its own).
        const ownDouble = hasOwnDouble(itemGroups);
        const mods = modifierPrice(itemGroups, withoutDouble(l.modifiers ?? [], ownDouble));
        if ("extra" in mods) {
          expected = Number(item.price) + mods.extra;
          if (!ownDouble && isDouble(l.modifiers)) {
            const d = priceWithDouble(
              expected,
              l.modifiers ?? [],
              { isAlcohol: item.is_alcohol, section: doubles.sectionOf(item.category_id), ownDouble, recipe: doubles.recipes.get(item.id) ?? null },
              doubles.settings,
            );
            if ("unit" in d) expected = d.unit;
            else problems.push(`"${l.name}" was rung as a double, but ${d.error}.`);
          }
        } else if ("unknown" in mods) problems.push(`"${l.name}": the option "${mods.unknown}" isn't on the menu anymore, so its price couldn't be checked.`);
        else note = `two options are called "${mods.ambiguous}", price not checked`;
        // The register won't add an item until its "pick one" questions are
        // answered, so an unanswered one means the line didn't come from there.
        for (const g of itemGroups) {
          if (g.must_choose && (g.type ?? "single") === "single" && !g.options.some((o) => (l.modifiers ?? []).includes(o.name))) {
            problems.push(`"${l.name}": nothing was picked for "${g.label ?? "a pick-one question"}", which has to be answered.`);
          }
        }
        if (item.is_alcohol !== l.is_alcohol) problems.push(`"${l.name}" was rung as ${l.is_alcohol ? "" : "not "}alcohol, but the menu says it ${item.is_alcohol ? "is" : "isn't"}.`);
      }
    } else if (sent < 0) {
      problems.push(`The custom item "${l.name}" has a negative price.`);
    }
    // A badge reward ($0, no menu item) and a custom item are taken at the
    // price rung: there's nothing on the menu to check them against.
    if (differs(sent, expected)) problems.push(`"${l.name}" was rung at ${money(sent)} each; the menu says ${money(expected)}.`);
    return { name: l.name, sent, expected, qty: l.quantity, note, perkBase };
  });

  // The daily coffee counts only if it was on the order (staff can take it
  // off) and it's allowed; one that isn't comes to $0 here.
  let dailyPerk = false;
  if (Number(sale.totals.daily_perk_discount ?? 0) > 0) {
    const coffee = sale.dailyCoffee ?? (await checkDailyCoffee(sale));
    dailyPerk = coffee.ok;
    if (!coffee.ok) problems.push(`Insiders+ daily coffee: ${coffee.reason} It came off the order anyway.`);
  }

  const t = registerTotals(lines.map((l) => ({ unit: l.expected, qty: l.qty, perkBase: l.perkBase })), member, sale.monthlyMember, sale.taxFree, sale.pointsRedeemed, dailyPerk);
  const server: ServerTotals = {
    subtotal: t.subtotal,
    daily_perk_discount: t.dailyPerkDiscount,
    tier_discount: t.tierDiscount,
    monthly_discount: t.monthlyDiscount,
    redemption_discount: t.redemptionDiscount,
    tax: t.tax,
    total: t.total,
  };
  for (const [key, label] of TOTAL_LABELS) {
    const sent = Number(sale.totals[key] ?? 0);
    const figured = Number(server[key] ?? 0);
    if (differs(sent, figured)) problems.push(`${label}: the register sent ${money(sent)}, the server figures ${money(figured)}.`);
  }

  // The payment: cash, card (a tip picked on the reader is inside it) and
  // vouchers cover the total plus the whole tip, whether it was asked on
  // the register or on the reader.
  if (sale.payment) {
    const { cash, card, voucher = 0 } = sale.payment;
    const tip = sale.tip ?? 0;
    if ([cash, card, voucher, tip].some((n) => Number(n) < 0)) problems.push("A payment or tip is negative.");
    const paid = cents(Number(cash) + Number(card) + Number(voucher));
    const due = cents(Number(sale.totals.total) + Number(tip));
    if (differs(paid, due)) problems.push(`Cash, card and vouchers add up to ${money(paid)}, but the sale (tip included) is ${money(due)}.`);
  }

  return { problems, server, lines, member };
}

// What pricing a double needs, for the menu items rung as one: where each
// sits on the Bar tab, its recipe (with each ingredient's kind) and the
// double settings. Nothing is read without a double on the sale.
async function doubleContext(
  supabase: ReturnType<typeof createAdminClient>,
  itemIds: string[],
): Promise<{ settings: DoubleSettings; recipes: Map<string, DoubleLine[]>; sectionOf: (categoryId: string) => ReturnType<typeof sectionOfCategory> }> {
  const settings = readDoubleSettings(null);
  if (!itemIds.length) return { settings, recipes: new Map(), sectionOf: () => null };
  type RecipeRow = { menu_item_id: string; ingredients: { quantity: number; optional?: boolean | null; ingredient: { name: string; unit: string; kind?: string | null } | null }[] };
  const read = (cols: string) => supabase.from("recipes").select(cols).in("menu_item_id", [...new Set(itemIds)]);
  const [cats, setting, withKind] = await Promise.all([
    supabase.from("menu_categories").select("id, key, label, parent_id"),
    supabase.from("settings").select("value").eq("key", DOUBLE_SETTING).maybeSingle(),
    read("menu_item_id, ingredients:recipe_ingredients(quantity, optional, ingredient:ingredients(name, unit, kind))"),
  ]);
  let recipeRows = withKind.data as unknown as RecipeRow[] | null;
  if (withKind.error) {
    const plain = await read("menu_item_id, ingredients:recipe_ingredients(quantity, ingredient:ingredients(name, unit))");
    if (plain.error) throw new Error(plain.error.message);
    recipeRows = plain.data as unknown as RecipeRow[];
  }
  if (cats.error) throw new Error(cats.error.message);
  const recipes = new Map<string, DoubleLine[]>();
  for (const r of recipeRows ?? []) {
    recipes.set(
      r.menu_item_id,
      (r.ingredients ?? [])
        .filter((i) => i.ingredient)
        .map((i) => ({ name: i.ingredient!.name, unit: i.ingredient!.unit, kind: i.ingredient!.kind ?? null, quantity: Number(i.quantity), optional: i.optional === true })),
    );
  }
  const categories = (cats.data ?? []) as { id: string; key: string | null; label: string | null; parent_id: string | null }[];
  return {
    settings: readDoubleSettings(setting.error ? null : setting.data?.value),
    recipes,
    sectionOf: (categoryId) => sectionOfCategory(categoryId, categories, isBarCategory, barSectionOf),
  };
}

// ---------- flags ----------

// What each kind means is in the table's migration
// (20261001200000_register_sale_flags.sql). kind is free text there, so a
// new one needs no migration: add it here and to that list.
export type SaleFlagKind =
  | "card_refused"
  | "card_unchecked"
  | "totals_mismatch"
  | "totals_refused"
  | "points_short"
  | "tab_closed_elsewhere"
  | "sale_abandoned"
  | "items_not_saved"
  | "below_cost";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best effort, never throws. The server log always gets it; the table does
// once its migration (20261001200000_register_sale_flags) is applied.
export async function flagSale(
  kind: SaleFlagKind,
  f: { orderId?: string | null; orderNumber?: number | null; employeeId?: string | null; paymentIntentId?: string | null; details: Record<string, unknown> },
) {
  const row = {
    kind,
    order_id: f.orderId ?? null,
    order_number: f.orderNumber ?? null,
    employee_id: f.employeeId && UUID.test(f.employeeId) ? f.employeeId : null,
    stripe_payment_intent_id: f.paymentIntentId ?? null,
    details: f.details,
  };
  console.warn(`[register-check] ${kind}`, JSON.stringify(row));
  try {
    const { error } = await createAdminClient().from("register_sale_flags").insert(row);
    if (error) console.warn("[register-check] flag not stored", error.message);
  } catch (e) {
    console.warn("[register-check] flag not stored", e);
  }
}
