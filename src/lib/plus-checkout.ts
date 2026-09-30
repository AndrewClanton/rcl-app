import "server-only";
import { siteOrigin } from "@/lib/site-origin";
import { getStripe } from "@/lib/stripe";
import { insidersPlusPriceIdFor } from "@/lib/member-rate";
import { salesTaxRateId } from "@/lib/stripe-tax";
import type { MemberPriceTier } from "@/lib/types";
import type { BillingInterval } from "@/lib/membership-rates";

export { hasPlusPerks, plusPaidFor, plusNeedsCard, giftEndsWithoutRenewal } from "@/lib/plus-status";

// Starts Stripe Checkout for an Insiders+ subscription and returns the page
// to send the person to. Stripe asks only for the card: the email comes
// from us (or from their Stripe customer, if they've paid us before), so
// nobody types what we already know. `returnTo` is where "Continue" goes
// after they've joined, e.g. the showtime they were looking at.
// `firstChargeAt` (staff only) saves the card now but holds the first
// charge until then -- for someone who already paid for this month another
// way (cash, or the old site). Stripe needs it at least 48 hours out.
// `interval`: monthly, or yearly at 15% off. `linkCard`: the member started
// this themselves, signed in, or staff did it for them, so the card they
// pay with is linked to their account for points (lib/member-cards.ts
// linkPlusCard). Never from the public join form, where anyone can type an
// existing member's email.
export async function createPlusCheckout(p: {
  memberId: string | null;
  customerId: string | null;
  name: string;
  email: string;
  phone: string | null;
  priceTier: MemberPriceTier;
  returnTo: string | null;
  firstChargeAt?: Date | null;
  interval?: BillingInterval;
  linkCard?: boolean;
}): Promise<string | null> {
  const interval = p.interval ?? "month";
  const priceId = await insidersPlusPriceIdFor(p.priceTier, interval);
  if (!priceId) return null;
  const origin = await siteOrigin();
  const back = p.returnTo ? `&next=${encodeURIComponent(p.returnTo)}` : "";
  // Missouri sales tax on top of the price, on every bill.
  const taxRate = await salesTaxRateId();
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1, tax_rates: [taxRate] }],
    ...(p.customerId ? { customer: p.customerId } : { customer_email: p.email }),
    client_reference_id: p.memberId ?? undefined,
    ...(p.firstChargeAt ? { subscription_data: { trial_end: Math.floor(p.firstChargeAt.getTime() / 1000) } } : {}),
    success_url: `${origin}/membership/welcome?session_id={CHECKOUT_SESSION_ID}${back}`,
    cancel_url: p.returnTo ? `${origin}${p.returnTo}` : `${origin}/membership?checkout=cancelled#join`,
    metadata: {
      member_id: p.memberId ?? "",
      pending_name: p.name,
      pending_email: p.email,
      pending_phone: p.phone ?? "",
      price_tier: p.priceTier,
      billing_interval: interval,
      ...(p.linkCard && p.memberId ? { link_card_member: p.memberId } : {}),
    },
  });
  return session.url;
}
