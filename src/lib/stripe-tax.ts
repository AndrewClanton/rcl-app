import "server-only";
import { getStripe } from "@/lib/stripe";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";

// Stripe adds sales tax to online tickets and Insiders+ through a "tax
// rate" saved in the Stripe account. We make it the first time it's needed
// and reuse it after (found again by its metadata), so there's nothing to
// set up by hand in the Stripe dashboard. Tax is added on top of the price.
let cached: string | null = null;

export async function salesTaxRateId(): Promise<string> {
  if (cached) return cached;
  const stripe = getStripe();
  for await (const rate of stripe.taxRates.list({ active: true, limit: 100 })) {
    if (rate.metadata?.rcl === "sales-tax" && rate.percentage === SALES_TAX_PERCENT && !rate.inclusive) {
      cached = rate.id;
      return rate.id;
    }
  }
  const rate = await stripe.taxRates.create({
    display_name: "Sales tax",
    description: "Joplin, MO combined sales tax",
    jurisdiction: "Joplin, MO",
    country: "US",
    state: "MO",
    percentage: SALES_TAX_PERCENT,
    inclusive: false,
    metadata: { rcl: "sales-tax" },
  });
  cached = rate.id;
  return rate.id;
}
