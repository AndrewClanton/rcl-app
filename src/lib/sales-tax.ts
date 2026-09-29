// Joplin, MO combined sales tax (state + county + city): 8.725%. This is the
// rate the business's quarterly Missouri filings are figured at. It applies
// to everything we sell -- food, drinks, movie tickets and Insiders+.
// (No server imports: the register and the ticket page use it too.)
export const SALES_TAX_PERCENT = 8.725;
export const SALES_TAX_RATE = SALES_TAX_PERCENT / 100;

// Tax on a pre-tax amount, rounded to the cent -- the same way Stripe rounds it.
export function salesTaxOn(amount: number): number {
  return Math.round(Math.max(0, amount) * SALES_TAX_RATE * 100) / 100;
}
