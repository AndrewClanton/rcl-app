import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { SALES_TAX_RATE } from "@/lib/sales-tax";
import type { MemberTier } from "@/lib/types";

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

export type TotalsLine = { unit: number; qty: number; perkBase?: number | null };

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

export function registerTotals(lines: TotalsLine[], member: TotalsMember, monthlyMember: boolean, taxFree: boolean, pointsRedeemed: boolean, dailyPerk = false) {
  const subtotal = cents(lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const perk = dailyPerk && member?.tier === "Insiders+" ? dailyPerkPick(lines) : null;
  const dailyPerkDiscount = perk ? Math.min(perk.amount, subtotal) : 0;
  // What the percentage discounts and a reward are figured on. Without a
  // daily coffee this is the subtotal, so every other order adds up exactly
  // as it always has.
  const rest = cents(subtotal - dailyPerkDiscount);
  const tierDiscount = cents(rest * memberDiscountRate(member));
  const monthlyDiscount = monthlyMember ? cents(rest * 0.1) : 0;
  const canRedeem = !!member && member.points >= POINTS_PER_REWARD;
  // A $5 reward on a $3 order takes $3 off, never more than what's left.
  const redemptionDiscount = canRedeem && pointsRedeemed ? cents(Math.min(REWARD_VALUE, Math.max(0, rest - tierDiscount - monthlyDiscount))) : 0;
  const discount = dailyPerkDiscount + tierDiscount + monthlyDiscount + redemptionDiscount;
  const taxable = subtotal - discount;
  // Never negative: a $5 reward on a $4 order is a free order, not a tax refund.
  const tax = taxFree ? 0 : cents(Math.max(0, taxable) * SALES_TAX_RATE);
  const total = cents(Math.max(0, taxable) + tax);
  return {
    subtotal,
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
export function pointsEarned(t: { subtotal: number; tier_discount: number; monthly_discount: number; redemption_discount: number; daily_perk_discount?: number }) {
  return Math.max(0, cents(t.subtotal - (Number(t.daily_perk_discount) || 0) - t.tier_discount - t.monthly_discount - t.redemption_discount));
}

// A badge reward the member cashed in on the register: a $0 line with no
// menu item, named "<reward> (badge reward)" by PosMemberPanel. Not a
// custom item.
export function isRewardLine(l: { menu_item_id: string | null; screening_id?: string | null; name: string; unit_price: number }) {
  return !l.menu_item_id && !l.screening_id && Number(l.unit_price) === 0 && l.name.endsWith("(badge reward)");
}

// ---------- the owner rate ----------
// Andrew, 10/3: the owners (a tick on the person: employees.owner_rate) can
// have anything on the menu at what it cost the business, so enjoying the
// place doesn't dig into the bottom line invisibly. The owner types their
// own PIN, and the order goes on their monthly owner tab instead of being
// paid (lib/owner-rate-server.ts, Back office -> Owner tab).
//
// How a line is priced:
// - A menu item at cost: its recipe, each ingredient's amount times its
//   unit cost (the same costs as the bar's pour cost). Only when the recipe
//   has at least one ingredient and every one of them has a cost: a partly
//   costed recipe would undercharge. Never more than the menu price.
// - No recipe, or an ingredient with no cost on file: half the menu price,
//   and the line says so, so someone can add the cost.
// - Options and add-ons (a shot of syrup, a second topping) have no recipes
//   of their own, so whatever they add to the price is charged at half.
//   One that takes money off takes half of that off.
// - Movie tickets and custom items: their normal price. (A badge reward or
//   a free Insiders+ seat is a member perk, so the server won't put one on
//   an owner tab: lib/owner-rate-server.ts.)
// The order is then taxed like any sale, with no member discount, monthly
// discount, daily coffee or points reward on top, and it earns no points.

export type OwnerPricing = "cost" | "half" | "menu";

export const OWNER_PRICING_LABEL: Record<OwnerPricing, string> = {
  cost: "at cost",
  half: "half price: no cost on file",
  menu: "normal price",
};

// Whose tab an order went on, on the register and in Recent orders.
export const ownerTabLabel = (firstName: string) => `Owner tab · ${firstName} · at cost`;
// The same on a printed receipt: the printer only prints plain ASCII, and
// drops a middle dot.
export const ownerTabReceiptLabel = (firstName: string) => `Owner tab - ${firstName} - at cost`;

// The register's short tag beside a line.
export const OWNER_PRICING_TAG: Record<OwnerPricing, string> = { cost: "at cost", half: "½ price", menu: "normal price" };

// A menu item as the owner rate sees it: its menu price, and what its
// recipe cost (null: no recipe, or an ingredient with no cost).
export interface OwnerItem {
  price: number;
  cost: number | null;
}

// Menu item id -> its price and cost, from the server after the owner's PIN.
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
  const base = item.cost !== null && item.cost !== undefined ? Number(item.cost) : Number(item.price) / 2;
  const unit = cents(Math.max(0, Math.min(menu, base + options / 2)));
  return { unit, how: item.cost !== null && item.cost !== undefined ? "cost" : "half" };
}

// An owner order's totals: the owner prices, taxed like any sale, with
// nothing else off (no member, no monthly 10%, no reward, no daily coffee).
export function ownerOrderTotals(lines: { unit: number; qty: number }[]) {
  return registerTotals(lines, null, false, false, false, false);
}

// What the register sent for an owner order against what the server
// figured from the recipes. One plain sentence per difference of more than
// a cent, so the sale is refused rather than saved at the register's word.
export function ownerSaleProblems(
  sent: { lines: { name: string; unit_price: number; quantity: number }[]; totals: { subtotal: number; tax: number; total: number } },
  figured: { lines: { name: string; unit_price: number; quantity: number }[]; totals: { subtotal: number; tax: number; total: number } },
): string[] {
  const problems: string[] = [];
  // Over a cent, or not a number at all (a missing figure is a difference).
  const off = (a: number, b: number) => !(Math.abs(Number(a) - Number(b)) <= 0.0101);
  if (sent.lines.length !== figured.lines.length) problems.push(`The register sent ${sent.lines.length} lines; the order has ${figured.lines.length}.`);
  sent.lines.forEach((l, i) => {
    const f = figured.lines[i];
    if (!f) return;
    if (l.quantity !== f.quantity) problems.push(`"${l.name}": the register sent ${l.quantity}, the order has ${f.quantity}.`);
    if (off(l.unit_price, f.unit_price)) problems.push(`"${l.name}" was sent at $${Number(l.unit_price).toFixed(2)} each; the owner rate is $${Number(f.unit_price).toFixed(2)}.`);
  });
  for (const key of ["subtotal", "tax", "total"] as const) {
    if (off(sent.totals[key], figured.totals[key])) problems.push(`${key[0].toUpperCase()}${key.slice(1)}: the register sent $${Number(sent.totals[key]).toFixed(2)}, the server figures $${Number(figured.totals[key]).toFixed(2)}.`);
  }
  return problems;
}

// The signed approval an owner's PIN gives the register (lib/approval-token.ts):
// for that owner, for one order (the nonce), for a few minutes.
export function ownerRateScope(ownerId: string, nonce: string) {
  return `owner-rate:${ownerId}:${nonce}`;
}
export const OWNER_RATE_APPROVAL_MS = 10 * 60_000;
