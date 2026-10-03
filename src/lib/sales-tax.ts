// Joplin, MO combined sales tax (state + county + city): 8.725%. This is the
// rate the business's quarterly Missouri filings are figured at. It applies
// to everything we sell -- food, drinks, movie tickets, booths, event
// deposits and Insiders+. This is the one place the rate lives: the
// register, the website, Stripe (lib/stripe-tax.ts finds or makes a Stripe
// tax rate at this percentage) and Reports all read it from here.
// (No server imports: the register and the ticket page use it too.)
//
// Nothing on the menu is tax-free. The only way a sale goes without tax is
// the register's "Tax exempt" tick (a customer with a Missouri exemption
// certificate), and a manager has to approve each one with their PIN.
export const SALES_TAX_PERCENT = 8.725;
export const SALES_TAX_RATE = SALES_TAX_PERCENT / 100;

// The rate in thousandths of a percent (8.725% -> 8725), so tax can be
// figured in whole cents without floating-point error.
const RATE_MILLI = Math.round(SALES_TAX_PERCENT * 1000);

// Tax on a pre-tax amount, rounded to the nearest cent (a half cent rounds
// up), the way Stripe and the database round it. Figured once on the
// order's total after discounts, never line by line. Whole-cent math: plain
// `amount * rate` came out a cent short on some amounts ($180 -> $15.70
// instead of $15.71).
export function salesTaxOn(amount: number): number {
  const amountCents = Math.round(Math.max(0, amount) * 100);
  return Math.round((amountCents * RATE_MILLI) / 100_000) / 100;
}

// The tax inside an amount that already includes it, in cents: $15.00 is
// $13.80 of price and $1.20 of tax. Works on refunds (negative) too.
export function taxInsideCents(amountCents: number): number {
  const sign = amountCents < 0 ? -1 : 1;
  const whole = Math.abs(Math.round(amountCents));
  return sign * (whole - Math.round((whole * 100_000) / (100_000 + RATE_MILLI)));
}

// Insiders+ and gift membership charges that went through with no tax on
// top (subscriptions started before tax was added on the evening of Sept.
// 28, 2026 keep renewing that way until tax is added to them in Stripe).
// How Reports, the nightly email and the Sales tax tab count them:
//   "included": as tax-included -- a $15.00 charge is $13.80 of sales and
//               $1.20 of sales tax.
//   "none":     as untaxed -- $15.00 of sales, no tax (how they were counted
//               before).
// Reporting only: it never changes what Stripe charges or what's saved.
export const UNTAXED_MEMBERSHIPS: "included" | "none" = "included";
