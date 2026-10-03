import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { salesTaxOn } from "@/lib/sales-tax";
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
  // Tax is figured once, on the whole order after every discount (tips are
  // never taxed), and rounded to the cent (lib/sales-tax.ts).
  const tax = taxFree ? 0 : salesTaxOn(taxable);
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
