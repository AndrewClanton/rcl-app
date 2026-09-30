import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { insidersPlusPriceId } from "@/lib/member-rate";
import { RATE_ORDER } from "@/lib/membership-rates";

// Insiders+ bills, for Reports -> Sales tax (getSalesTaxReport in
// ./reports.ts). Stripe bills and taxes the memberships itself (the sales tax
// rate is on every bill, src/lib/plus-checkout.ts), so nothing about them is
// in the database: they're read from Stripe each time.

export interface PlusBill {
  paidAt: string;
  sales: number; // the Insiders+ lines before tax, after any discount
  tax: number;
}

// A bill whose card failed and went through on a later retry counts when it
// was paid, so bills made up to this long before the window are looked at too.
const RETRY_DAYS = 62;

// Each rate's monthly price is a Vercel setting, and its yearly price is
// made on the same Stripe product (src/lib/member-rate.ts). So a bill line is
// Insiders+ when its price is one of those, or its product is theirs (the
// yearly prices, and any older price on the product).
async function plusPrices(stripe: Stripe): Promise<{ prices: Set<string>; products: Set<string> }> {
  const ids = RATE_ORDER.map(insidersPlusPriceId).filter((id): id is string => !!id);
  if (!ids.length) throw new Error("No Insiders+ price is set (STRIPE_PRICE_INSIDERS_PLUS_ADULT and the others).");
  const prices = await Promise.all(ids.map((id) => stripe.prices.retrieve(id)));
  return { prices: new Set(ids), products: new Set(prices.map((p) => (typeof p.product === "string" ? p.product : p.product.id))) };
}

const total = (parts: { amount: number }[] | null | undefined) => (parts ?? []).reduce((s, p) => s + p.amount, 0);

// Every paid bill with Insiders+ on it, paid between two instants (business
// day edges), with what its Insiders+ lines came to. Reads every page of
// bills, and of a bill's lines past the first ten. Throws when Stripe can't
// be read: the report says so rather than show a total without them.
export async function getInsidersPlusBills(start: string, end: string): Promise<PlusBill[]> {
  const stripe = getStripe();
  const plus = await plusPrices(stripe);
  const from = Date.parse(start);
  const to = Date.parse(end);
  const out: PlusBill[] = [];
  const bills = stripe.invoices.list({ status: "paid", created: { gte: Math.floor(from / 1000) - RETRY_DAYS * 86_400, lt: Math.ceil(to / 1000) }, limit: 100 });
  for await (const bill of bills) {
    const paidAt = (bill.status_transitions.paid_at ?? bill.created) * 1000;
    if (paidAt < from || paidAt >= to) continue;
    const lines = bill.lines.has_more ? await stripe.invoices.listLineItems(bill.id, { limit: 100 }).autoPagingToArray({ limit: 10_000 }) : bill.lines.data;
    let sales = 0;
    let tax = 0;
    let found = false;
    for (const line of lines) {
      const details = line.pricing?.price_details;
      if (!details) continue;
      const priceId = typeof details.price === "string" ? details.price : details.price.id;
      if (!plus.prices.has(priceId) && !plus.products.has(details.product)) continue;
      found = true;
      // Cents. The line's amount is before discounts, and includes the tax
      // only when the rate is tax-inclusive (ours isn't).
      const inclusive = (line.taxes ?? []).filter((t) => t.tax_behavior === "inclusive");
      sales += line.amount - total(line.discount_amounts) - total(inclusive);
      tax += total(line.taxes);
    }
    if (found) out.push({ paidAt: new Date(paidAt).toISOString(), sales: sales / 100, tax: tax / 100 });
  }
  return out;
}
