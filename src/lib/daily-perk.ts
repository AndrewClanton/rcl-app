// The Insiders+ daily coffee: one free black coffee or hot tea per
// business day (4 a.m. to 4 a.m. Central, lib/ops/time.ts) for a member
// with Insiders+ perks.
//
// - Which items count: menu_items.daily_perk, ticked on Back office ->
//   Menu (Drip coffee and Batch brew to start).
// - The register applies it on its own when an Insiders+ member is on the
//   order, the order has one of those items and today's is still unused:
//   one of them comes off at its menu price (paid add-ons on it are still
//   charged). Staff can take it off. registerTotals
//   (lib/register-totals.ts) does the math, before the percentage
//   discounts, and it earns no points.
// - The sale records it on the order: orders.daily_perk_discount (the
//   money given away, its own line in Reports) and orders.daily_perk_date
//   (the business day it was used). The database allows one completed
//   order per member and day with a date, so a refunded or voided order
//   frees that day's coffee again.
// - The server checks it again before payment and when the sale is saved
//   (checkDailyCoffee in lib/register-sale-checks.ts).
//
// No server imports: the register and the account pages use this too.

// The register's row for it on the order.
export const DAILY_COFFEE_TITLE = "Daily coffee · Insiders+";
// Its discount line on receipts, Recent orders, the customer screen and in
// Reports (plain ASCII: the receipt printer drops anything else).
export const DAILY_COFFEE_LINE = "Insiders+ daily coffee";
// How it's described to customers wherever Insiders+ perks are listed.
export const DAILY_COFFEE_PERK = "A free black coffee or hot tea, every day";

// A member's coffee today: usedAt is when today's went (null: still ready).
export interface DailyCoffeeState {
  usedAt: string | null;
  orderNumber: number | null;
}

// "9:14 AM", Central.
export function coffeeTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}
