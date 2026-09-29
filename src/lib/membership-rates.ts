import type { MemberPriceTier } from "@/lib/types";

// Insiders+ monthly price by rate. Senior and student are set in person by
// staff after checking an ID, never chosen online.
export const RATE_PRICE: Record<MemberPriceTier, number> = { adult: 15, senior: 12, student: 10 };
export const RATE_LABEL: Record<MemberPriceTier, string> = { adult: "Adult", senior: "Senior", student: "Student" };
export const RATE_ORDER: MemberPriceTier[] = ["adult", "senior", "student"];

// Paying for a year up front is 15% off twelve months: $153 adult, $122.40
// senior, $102 student (plus sales tax, like the monthly price).
export type BillingInterval = "month" | "year";
export const ANNUAL_DISCOUNT = 0.15;
export const ANNUAL_PRICE: Record<MemberPriceTier, number> = {
  adult: Math.round(RATE_PRICE.adult * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100,
  senior: Math.round(RATE_PRICE.senior * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100,
  student: Math.round(RATE_PRICE.student * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100,
};

// "$162" / "$129.60": whole dollars without the cents.
export function dollars(n: number) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function planPrice(tier: MemberPriceTier, interval: BillingInterval) {
  return interval === "year" ? `${dollars(ANNUAL_PRICE[tier])}/year` : `${dollars(RATE_PRICE[tier])}/month`;
}
