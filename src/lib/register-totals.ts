import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { SALES_TAX_RATE } from "@/lib/sales-tax";
import type { MemberTier } from "@/lib/types";

// The register's order math, for the server to redo and compare with what a
// register sent (src/lib/register-sale-checks.ts). It mirrors computeTotals
// in src/app/pos/PosApp.tsx step for step: a change to one needs the same
// change in the other. (No server imports: the register reads the switch
// below.)

// Log-only for now. A sale whose totals don't match the server's math is
// saved and flagged (register_sale_flags, plus the server log), never
// refused. Set to true to refuse those sales instead: the register then
// checks before taking payment, so a refused sale never has a charged card.
// Read the flags first -- see "Switching to enforce" in the checks file.
export const ENFORCE_REGISTER_TOTALS = false;

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
  const tax = taxFree ? 0 : cents(Math.max(0, taxable) * SALES_TAX_RATE);
  const total = cents(Math.max(0, taxable) + tax);
  return { subtotal, tierDiscount, monthlyDiscount, redemptionDiscount, discount, tax, total, canRedeem };
}

// Points a sale earns: 1 per $1 of what was bought after discounts (member,
// monthly and reward), before tax. Never negative.
export function pointsEarned(t: { subtotal: number; tier_discount: number; monthly_discount: number; redemption_discount: number }) {
  return Math.max(0, cents(t.subtotal - t.tier_discount - t.monthly_discount - t.redemption_discount));
}
