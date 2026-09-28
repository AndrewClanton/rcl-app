import "server-only";
import { siteOrigin } from "@/lib/site-origin";
import { getStripe } from "@/lib/stripe";
import { insidersPlusPriceId } from "@/lib/member-rate";
import type { Member, MemberPriceTier } from "@/lib/types";

// Already Insiders+ (paid or complimentary), or has a subscription Stripe
// is still collecting on -- either way, a second checkout would be a
// second membership. Those people go to their billing page instead.
export function hasPlus(member: Pick<Member, "tier" | "stripe_subscription_id" | "subscription_status">): boolean {
  if (member.tier === "Insiders+") return true;
  return !!member.stripe_subscription_id && ["active", "trialing", "past_due", "unpaid"].includes(member.subscription_status ?? "");
}

// Starts Stripe Checkout for an Insiders+ subscription and returns the page
// to send the person to. Stripe asks only for the card: the email comes
// from us (or from their Stripe customer, if they've paid us before), so
// nobody types what we already know. `returnTo` is where "Continue" goes
// after they've joined, e.g. the showtime they were looking at.
export async function createPlusCheckout(p: {
  memberId: string | null;
  customerId: string | null;
  name: string;
  email: string;
  phone: string | null;
  priceTier: MemberPriceTier;
  returnTo: string | null;
}): Promise<string | null> {
  const priceId = insidersPlusPriceId(p.priceTier);
  if (!priceId) return null;
  const origin = await siteOrigin();
  const back = p.returnTo ? `&next=${encodeURIComponent(p.returnTo)}` : "";
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(p.customerId ? { customer: p.customerId } : { customer_email: p.email }),
    client_reference_id: p.memberId ?? undefined,
    success_url: `${origin}/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}${back}`,
    cancel_url: p.returnTo ? `${origin}${p.returnTo}` : `${origin}/membership?checkout=cancelled#join`,
    metadata: {
      member_id: p.memberId ?? "",
      pending_name: p.name,
      pending_email: p.email,
      pending_phone: p.phone ?? "",
      price_tier: p.priceTier,
    },
  });
  return session.url;
}
