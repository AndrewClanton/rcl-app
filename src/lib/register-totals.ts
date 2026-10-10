import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { salesTaxOn } from "@/lib/sales-tax";
import type { MemberTier } from "@/lib/types";
import { taxInside } from "@/lib/orgs";

// The register's order math, in one place: the register (PosApp) figures
// every order with registerTotals, and the server redoes it from menu
// prices to check each sale (src/lib/register-sale-checks.ts). No server
// imports, so the register can use it too.
//
// What goes in, as the register rings it:
// - lines: price each (an item's price plus its options, a "pick one"
//   option included; a movie ticket's price, $0 for a free Insiders+
//   entry; a custom item's typed price) and how many. A badge reward
//   (PosMemberPanel) is a $0 line with no menu item.
// - the Insiders+ daily coffee (lib/daily-perk.ts): the one line whose item
//   is ticked as a daily coffee (perkBase: its menu price; null for
//   anything else) that it takes the most off comes off at that price,
//   add-ons not included, when dailyPerk is on and the member is
//   Insiders+. It comes off first, so the percentage discounts are figured
//   on what's left (10% off a free coffee is nothing).
// - member discount (10%, Insiders+ only: plain Insiders earn points
//   instead of a discount), the monthly member 10%, and a
//   points reward, capped at what's left after the other two.
// - an organization comp (lib/orgs.ts): `comp` on a line is how many of it
//   the organization covers (a day pass, a movie ticket), at its price. It
//   comes off before anything else.
// - taxIncluded (an organization's supported guest, lib/orgs.ts): the
//   price is the total, with the tax inside it, so a $4 pizza is $4.00 even
//   ($3.68 plus $0.32 tax). Everything else adds tax on top.
// Not in here: the tip and vouchers. A tip goes on top of the total (asked
// on the register for a tab when there's no reader, or picked on the card
// reader, which adds it to the card amount). Vouchers are a way to pay,
// like cash or card, not a discount.

// Log-only for now. A sale whose totals don't match the server's math is
// saved and flagged (register_sale_flags, plus the server log), never
// refused. Set to true to refuse those sales instead: the register then
// checks before taking payment, so a refused sale never has a charged card.
// Read the flags first -- see "Switching to enforce" in the checks file.
export const ENFORCE_REGISTER_TOTALS = false;

// Every money figure is rounded to the cent, so the tax shown, the total
// charged on the card and the order saved all agree to the penny.
export const cents = (n: number) => Math.round(n * 100) / 100;

export type TotalsMember = { tier: MemberTier; points: number } | null;

export function memberDiscountRate(member: TotalsMember) {
  if (!member) return 0;
  return member.tier === "Insiders+" ? 0.1 : 0;
}

// giftCard: a gift card being sold (isGiftCardLine). It isn't a sale of
// anything yet, so it's never taxed, never discounted and earns no points;
// the tax comes when the card is spent on taxable things, since paying
// with a gift card is a way to pay, like cash or card, not a discount.
export type TotalsLine = { unit: number; qty: number; perkBase?: number | null; comp?: number; giftCard?: boolean };

// A gift card on the register: the Gift card button's line ("Gift card"),
// or the custom item staff rang before it existed ("$50 Gift Card"). No
// menu item, no showing, no reward; the name is all it is. No manager PIN:
// a gift card is tax-free by what it is, not by anyone's say-so.
export function isGiftCardLine(l: {
  menu_item_id?: string | null;
  menuItemId?: string | null;
  screening_id?: string | null;
  screeningId?: string | null;
  reward_id?: string | null;
  rewardId?: string | null;
  name: string;
}) {
  if (l.menu_item_id || l.menuItemId || l.screening_id || l.screeningId || l.reward_id || l.rewardId) return false;
  return /^(\$\d+(\.\d{2})? )?gift ?card$/i.test(String(l.name ?? "").trim());
}

// What the gift cards sold on an order come to, to the cent.
export function giftCardSales(lines: { unit: number; qty: number; giftCard?: boolean }[]) {
  return cents(lines.reduce((s, l) => s + (l.giftCard ? Math.max(0, Number(l.unit) || 0) * (Number(l.qty) || 0) : 0), 0));
}

export type TotalsExtra = { taxIncluded?: boolean };

// The line the daily coffee goes on, and how much comes off: the eligible
// line it takes the most off (the first, on a tie). Never more than the
// line's own price each, so an option that lowers the price can't push it
// below nothing.
export function dailyPerkPick(lines: TotalsLine[]): { index: number; amount: number } | null {
  let best: { index: number; amount: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const l = lines[index];
    const base = Number(l.perkBase);
    if (!(base > 0) || !(l.qty >= 1)) continue;
    const amount = cents(Math.min(base, Math.max(0, Number(l.unit))));
    if (amount > 0 && (!best || amount > best.amount)) best = { index, amount };
  }
  return best;
}

export function registerTotals(allLines: TotalsLine[], member: TotalsMember, monthlyMember: boolean, taxFree: boolean, pointsRedeemed: boolean, dailyPerk = false, extra: TotalsExtra = {}) {
  // Gift cards sold go on at the end: everything below (comps, the daily
  // coffee, discounts, tax) is figured on the rest. Each keeps its place in
  // the list at $0, so the daily coffee's line number still matches.
  const giftCards = giftCardSales(allLines);
  const lines = giftCards > 0 ? allLines.map((l) => (l.giftCard ? { ...l, unit: 0, perkBase: null, comp: 0 } : l)) : allLines;
  const goods = cents(lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const subtotal = cents(goods + giftCards);
  // An organization's comps: never more than the order.
  const compOf = (l: TotalsLine) => Math.min(l.qty, Math.max(0, Math.floor(Number(l.comp) || 0)));
  const orgCompDiscount = cents(Math.min(goods, lines.reduce((s, l) => s + Math.max(0, l.unit) * compOf(l), 0)));
  // A comped line is never the free coffee.
  const perkLines = orgCompDiscount > 0 ? lines.map((l) => (compOf(l) > 0 ? { ...l, perkBase: null } : l)) : lines;
  const perk = dailyPerk && member?.tier === "Insiders+" ? dailyPerkPick(perkLines) : null;
  const dailyPerkDiscount = perk ? Math.min(perk.amount, cents(goods - orgCompDiscount)) : 0;
  // What the percentage discounts and a reward are figured on. Without a
  // daily coffee or a comp this is the subtotal, so every other order adds
  // up exactly as it always has.
  const rest = cents(goods - orgCompDiscount - dailyPerkDiscount);
  const tierDiscount = cents(rest * memberDiscountRate(member));
  const monthlyDiscount = monthlyMember ? cents(rest * 0.1) : 0;
  const canRedeem = !!member && member.points >= POINTS_PER_REWARD;
  // A $5 reward on a $3 order takes $3 off, never more than what's left.
  const redemptionDiscount = canRedeem && pointsRedeemed ? cents(Math.min(REWARD_VALUE, Math.max(0, rest - tierDiscount - monthlyDiscount))) : 0;
  const discount = orgCompDiscount + dailyPerkDiscount + tierDiscount + monthlyDiscount + redemptionDiscount;
  const taxable = goods - discount;
  // Never negative: a $5 reward on a $4 order is a free order, not a tax refund.
  // Tax is figured once, on the whole order after every discount (tips are
  // never taxed), and rounded to the cent (lib/sales-tax.ts).
  const taxIncluded = !taxFree && !!extra.taxIncluded;
  const tax = taxFree ? 0 : taxIncluded ? taxInside(taxable).tax : salesTaxOn(taxable);
  const total = cents((taxIncluded ? Math.max(0, taxable) : Math.max(0, taxable) + tax) + giftCards);
  return {
    subtotal,
    // Gift cards sold on the order: in the subtotal and the total, untaxed.
    giftCardSales: giftCards,
    orgCompDiscount,
    // The tax is inside the total (an organization's supported guest).
    taxIncluded,
    dailyPerkDiscount,
    // Which of `lines` the daily coffee is on (null: none).
    dailyPerkLine: perk && dailyPerkDiscount > 0 ? perk.index : null,
    tierDiscount,
    monthlyDiscount,
    redemptionDiscount,
    discount,
    tax,
    total,
    canRedeem,
  };
}

// Points a sale earns: 1 per $1 of what was bought after discounts (the
// daily coffee, member, monthly and reward), before tax and tip, so a free
// coffee earns nothing. Never negative. completeOrder pays this, and the
// customer screen shows it. (A sale rung before the daily coffee existed
// has no daily_perk_discount.)
// An organization's comps earn nothing, and a tax-included sale earns on
// what it came to before its tax.
export function pointsEarned(t: {
  subtotal: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  daily_perk_discount?: number;
  org_comp_discount?: number;
  tax_included?: boolean;
  tax?: number;
  // Gift cards sold on it earn nothing (points come when a card is spent).
  gift_card_sales?: number;
}) {
  const inside = t.tax_included ? Number(t.tax) || 0 : 0;
  return Math.max(
    0,
    cents(t.subtotal - (Number(t.gift_card_sales) || 0) - (Number(t.daily_perk_discount) || 0) - (Number(t.org_comp_discount) || 0) - t.tier_discount - t.monthly_discount - t.redemption_discount - inside),
  );
}

// A badge reward the member cashed in on the register: a $0 line with no
// menu item, named "<reward> (badge reward)" by PosMemberPanel. Not a
// custom item.
export function isRewardLine(l: { menu_item_id: string | null; screening_id?: string | null; name: string; unit_price: number }) {
  // Or a reward bought with points on the customer screen:
  // "Reward: Personal popcorn (−40 pts)" (lib/rewards.ts).
  if (l.menu_item_id || l.screening_id || Number(l.unit_price) !== 0) return false;
  return l.name.endsWith("(badge reward)") || (l.name.startsWith("Reward: ") && / pts\)$/.test(l.name));
}

// ---------- the owner rate ----------
// Andrew, 10/5: an owner (an employee with role owner and the owner rate
// switched on in Back office -> Owner rate, employees.owner_rate) pays
// cost + 10% for anything on the menu. When that owner's own member account
// is on the order, the register shows an "Owner rate" tick beside Monthly
// member and Tax exempt; ticking it reprices the order, and it's paid at the
// register like any order (card, cash or a split). No PIN: the owner's own
// account has to be on the order (the server checks it), and the order keeps
// who rang it (orders.employee_id) and whose account it was
// (orders.member_id), with owner_menu_value marking it as an owner-rate sale.
// (lib/owner-rate-server.ts prices it on the server.)
//
// How a line is priced:
// - A menu item at cost + 10%: its recipe, each ingredient's amount times
//   its unit cost (the same costs as the bar's pour cost), plus
//   OWNER_RATE_MARKUP. Only when the recipe has at least one ingredient and
//   every one of them has a cost: a partly costed recipe would undercharge.
//   Never more than the menu price.
// - No recipe, or an ingredient with no cost on file: half the menu price,
//   and the line says so, so someone can add the cost.
// - Options and add-ons (a shot of syrup, a second topping) have no recipes
//   of their own, so whatever they add to the price is charged at half.
//   One that takes money off takes half of that off.
// - Movie tickets and custom items: their normal price. (A badge reward or
//   a free Insiders+ seat is a member perk, so the server won't price one
//   at the owner rate: lib/owner-rate-server.ts.)
// The order is then taxed like any sale, with no member discount, monthly
// discount, daily coffee, reward or organization comp on top, and it earns
// no points.

// What's added to an item's cost: one setting for the whole owner rate.
export const OWNER_RATE_MARKUP = 0.1;
export const OWNER_RATE_NAME = "cost + 10%";

// An item's cost at the owner rate (its cost plus the markup), to the cent.
export const ownerCostPrice = (cost: number) => cents(Number(cost) * (1 + OWNER_RATE_MARKUP));

export type OwnerPricing = "cost" | "half" | "menu";

export const OWNER_PRICING_LABEL: Record<OwnerPricing, string> = {
  cost: `at ${OWNER_RATE_NAME}`,
  half: "half price: no cost on file",
  menu: "normal price",
};

// An order from before 10/5 that went on an owner's monthly tab (none were
// ever made; kept so an old one would still read right in Recent orders).
export const ownerTabLabel = (firstName: string) => `Owner tab · ${firstName} · at cost`;
// The same on a printed receipt: the printer only prints plain ASCII, and
// drops a middle dot.
export const ownerTabReceiptLabel = (firstName: string) => `Owner tab - ${firstName} - at cost`;

// The register's short tag beside a line.
export const OWNER_PRICING_TAG: Record<OwnerPricing, string> = { cost: OWNER_RATE_NAME, half: "½ price", menu: "normal price" };

// A menu item as the owner rate sees it: its menu price, and what its
// recipe cost (null: no recipe, or an ingredient with no cost).
export interface OwnerItem {
  price: number;
  cost: number | null;
}

// Menu item id -> its price and cost, from the server.
export type OwnerBook = Record<string, OwnerItem>;

// What a recipe cost the business, to the cent. Null when there's nothing
// to go on. Added up in a fixed order (by ingredient), so the register and
// the server get the very same figure however the database lists them.
export function recipeCost(ingredients: { ingredientId?: string; quantity: number; unitCost: number | null | undefined }[] | null | undefined): number | null {
  if (!ingredients || ingredients.length === 0) return null;
  let cost = 0;
  const ordered = [...ingredients].sort((a, b) => (a.ingredientId ?? "").localeCompare(b.ingredientId ?? "") || Number(a.quantity) - Number(b.quantity));
  for (const i of ordered) {
    const unit = i.unitCost;
    if (unit === null || unit === undefined || !Number.isFinite(Number(unit)) || Number(unit) < 0) return null;
    if (!(Number(i.quantity) > 0)) return null;
    cost += Number(i.quantity) * Number(unit);
  }
  return cents(cost);
}

// One line at the owner rate. `unit` is the line's menu price each, its
// options included (as rung); `item` is its menu item (missing for a
// ticket, a custom item, or an item the book doesn't have, which is
// charged half of what it was rung at).
export function ownerLinePrice(line: { menuItemId: string | null; screeningId?: string | null; unit: number }, item: OwnerItem | null | undefined): { unit: number; how: OwnerPricing } {
  // Whole cents first, so the register and the server start from the same
  // figures (a price built up option by option can be a hair off).
  const menu = cents(Math.max(0, Number(line.unit) || 0));
  if (line.screeningId || !line.menuItemId) return { unit: menu, how: "menu" };
  if (!item) return { unit: cents(menu / 2), how: "half" };
  // What the options added (or took off), half of it either way.
  const options = cents(menu - Number(item.price));
  const costed = item.cost !== null && item.cost !== undefined;
  const base = costed ? ownerCostPrice(Number(item.cost)) : Number(item.price) / 2;
  const unit = cents(Math.max(0, Math.min(menu, base + options / 2)));
  return { unit, how: costed ? "cost" : "half" };
}

// An off-menu Bar Book drink or a custom drink ("What's in it?") at the
// owner rate: cost + 10% when every required ingredient has a cost
// (drinkCost in lib/bar/pricing.ts), never more than the price it was rung
// at; else half of that price. A double on one is half too (its second pour
// isn't in the recipe's cost). The server prices these
// (lib/owner-rate-server.ts) and the register shows the server's figure.
export function ownerOffMenuPrice(rung: number, cost: { cost: number | null; anyCost: boolean } | null | undefined, double = false): { unit: number; how: OwnerPricing } {
  const menu = cents(Math.max(0, Number(rung) || 0));
  if (!double && cost && cost.anyCost && cost.cost !== null && cost.cost !== undefined && Number.isFinite(Number(cost.cost))) {
    return { unit: cents(Math.min(menu, ownerCostPrice(Number(cost.cost)))), how: "cost" };
  }
  return { unit: cents(menu / 2), how: "half" };
}

// What an owner-rate order can't carry: member discounts, the monthly 10%,
// a points reward, the daily coffee, an organization's comps, tax-exempt and
// tax-included pricing (the register turns them off when the box is ticked;
// the server refuses any that come anyway). The owner's member account is on
// the order: that's what lets the owner rate on. null: nothing in the way;
// else the sentence for the cashier.
export function ownerOrderExtras(o: {
  monthlyMember?: boolean;
  pointsRedeemed?: boolean;
  taxFree?: boolean;
  orgComps?: number | null;
  taxIncluded?: boolean;
  discounts?: number | null;
}): string | null {
  if (Number(o.orgComps ?? 0) > 0) return "An organization's comps don't go with the owner rate. Untick Owner rate, or ring it without the comp.";
  if (o.taxIncluded) return "Tax-included pricing doesn't go with the owner rate: an owner-rate order is taxed as usual.";
  if (o.monthlyMember || o.pointsRedeemed || Number(o.discounts ?? 0) > 0) return "Member discounts, the daily coffee and rewards don't go with the owner rate. Untick them, or untick Owner rate.";
  if (o.taxFree) return "An owner-rate order is taxed as usual. Untick Tax exempt.";
  return null;
}

// An owner order's totals: the owner prices, taxed like any sale, with
// nothing else off (no member, no monthly 10%, no reward, no daily coffee).
// A gift card on it is never taxed (giftCard: isGiftCardLine).
export function ownerOrderTotals(lines: { unit: number; qty: number; giftCard?: boolean }[]) {
  return registerTotals(lines, null, false, false, false, false);
}

// Over a cent, or not a number at all (a missing figure is a difference).
const offByMore = (a: number, b: number) => !(Math.abs(Number(a) - Number(b)) <= 0.0101);

// A line as it was rung (unit_price: its menu price each, as rung) against
// the same line priced by the server from today's menu (menu_unit_price).
// A held order or tab rung before a price changed is caught here, naming
// the line: it's taken off and rung again at today's price. Then, when the
// register sent totals, those against the server's. One plain sentence per
// difference of more than a cent; the order isn't saved on the register's
// word.
export function ownerSaleProblems(
  sent: { lines: { name: string; unit_price: number }[]; totals?: { subtotal: number; tax: number; total: number } },
  priced: { lines: { menu_unit_price: number }[]; totals: { subtotal: number; tax: number; total: number } },
): string[] {
  const problems: string[] = [];
  if (sent.lines.length !== priced.lines.length) return ["The order changed while it was being priced. Try again."];
  sent.lines.forEach((l, i) => {
    const menu = priced.lines[i].menu_unit_price;
    if (offByMore(l.unit_price, menu)) {
      problems.push(`"${l.name}" was rung at $${Number(l.unit_price).toFixed(2)}, and it's $${Number(menu).toFixed(2)} on the menu now. Take it off the order and ring it again.`);
    }
  });
  if (sent.totals && (["subtotal", "tax", "total"] as const).some((k) => offByMore(sent.totals![k], priced.totals[k]))) {
    problems.push(`The owner-rate total on the register ($${Number(sent.totals.total).toFixed(2)}) isn't what the order comes to now ($${Number(priced.totals.total).toFixed(2)}).`);
  }
  return problems;
}

// The order the register's owner-rate prices were figured for, to tell when
// it changes (a line added, taken off or changed): the register asks the
// server for the new prices.
export function ownerCartKey(lines: { menuItemId: string | null; screeningId?: string | null; name: string; unit: number; qty: number; mods: string[] }[]): string {
  return JSON.stringify(lines.map((l) => [l.menuItemId ?? "", l.screeningId ?? "", l.name, cents(l.unit), l.qty, l.mods]));
}

// The Owner rate line in Reports and the nightly email: "Owner rate: $X at
// cost + 10%" beside "$Y off menu", and whose accounts used it.
export function ownerRateLine(r: { sales: number; menuValue: number; who: { name: string; orders: number }[] }): { label: string; value: string; who: string } {
  const usd = (n: number) => `$${cents(n).toFixed(2)}`;
  return {
    label: `Owner rate: ${usd(r.sales)} at ${OWNER_RATE_NAME}`,
    value: `${usd(r.menuValue - r.sales)} off menu`,
    who: r.who.map((w) => (w.orders > 1 ? `${w.name} ×${w.orders}` : w.name)).join(", "),
  };
}
