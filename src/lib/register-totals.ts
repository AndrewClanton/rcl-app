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
// - member discount (5%, 10% for Insiders+), the monthly member 10%, and a
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
  return member.tier === "Insiders+" ? 0.1 : 0.05;
}

export function registerTotals(lines: { unit: number; qty: number }[], member: TotalsMember, monthlyMember: boolean, taxFree: boolean, pointsRedeemed: boolean) {
  const subtotal = cents(lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const tierDiscount = cents(subtotal * memberDiscountRate(member));
  const monthlyDiscount = monthlyMember ? cents(subtotal * 0.1) : 0;
  const canRedeem = !!member && member.points >= POINTS_PER_REWARD;
  // A $5 reward on a $3 order takes $3 off, never more than what's left.
  const redemptionDiscount = canRedeem && pointsRedeemed ? cents(Math.min(REWARD_VALUE, Math.max(0, subtotal - tierDiscount - monthlyDiscount))) : 0;
  const discount = tierDiscount + monthlyDiscount + redemptionDiscount;
  const taxable = subtotal - discount;
  // Never negative: a $5 reward on a $4 order is a free order, not a tax refund.
  const tax = taxFree ? 0 : cents(Math.max(0, taxable) * SALES_TAX_RATE);
  const total = cents(Math.max(0, taxable) + tax);
  return { subtotal, tierDiscount, monthlyDiscount, redemptionDiscount, discount, tax, total, canRedeem };
}

// Points a sale earns: 1 per $1 of what was bought after discounts (member,
// monthly and reward), before tax and tip. Never negative. completeOrder
// pays this, and the customer screen shows it.
export function pointsEarned(t: { subtotal: number; tier_discount: number; monthly_discount: number; redemption_discount: number }) {
  return Math.max(0, cents(t.subtotal - t.tier_discount - t.monthly_discount - t.redemption_discount));
}

// A badge reward the member cashed in on the register: a $0 line with no
// menu item, named "<reward> (badge reward)" by PosMemberPanel. Not a
// custom item.
export function isRewardLine(l: { menu_item_id: string | null; screening_id?: string | null; name: string; unit_price: number }) {
  return !l.menu_item_id && !l.screening_id && Number(l.unit_price) === 0 && l.name.endsWith("(badge reward)");
}
