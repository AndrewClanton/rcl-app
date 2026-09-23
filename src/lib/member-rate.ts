import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import type { MemberPriceTier } from "@/lib/types";
import { RATE_LABEL, RATE_PRICE } from "@/lib/membership-rates";

// Insiders+ is $15/mo, or $12 / $10 for seniors and students. Those two are
// never self-selected online: people join at the adult rate and staff switch
// them after checking an ID in person (the register or a member's admin page).

const PRICE_ENV_KEY: Record<MemberPriceTier, string> = {
  adult: "STRIPE_PRICE_INSIDERS_PLUS_ADULT",
  senior: "STRIPE_PRICE_INSIDERS_PLUS_SENIOR",
  student: "STRIPE_PRICE_INSIDERS_PLUS_STUDENT",
};

export function insidersPlusPriceId(tier: MemberPriceTier): string | undefined {
  return process.env[PRICE_ENV_KEY[tier]];
}

// Reverse lookup, for a subscription whose price was changed some other way
// (e.g. in the Stripe dashboard).
export function tierForPriceId(priceId: string | null | undefined): MemberPriceTier | null {
  if (!priceId) return null;
  return (Object.keys(PRICE_ENV_KEY) as MemberPriceTier[]).find((t) => insidersPlusPriceId(t) === priceId) ?? null;
}

const LIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due"]);

export type RateChangeResult = { ok: true; message: string } | { ok: false; error: string };

function shortDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

// Switches a member's rate. For a paying Insiders+ member this also swaps the
// price on their Stripe subscription, effective from their next bill: no
// partial charge or credit now, and their billing day stays the same.
// Stripe is changed first, so a failure there leaves everything as it was;
// running it again after a later failure is safe.
export async function applyMemberRate(memberId: string, tier: MemberPriceTier, setBy: string | null): Promise<RateChangeResult> {
  const supabase = createAdminClient();
  const { data: member, error } = await supabase
    .from("members")
    .select("id, name, tier, price_tier, comped, stripe_subscription_id, subscription_status")
    .eq("id", memberId)
    .maybeSingle();
  if (error || !member) return { ok: false, error: "Couldn't find that member." };

  const first = member.name.split(" ")[0];
  const label = RATE_LABEL[tier];
  const price = RATE_PRICE[tier];
  let message: string;

  if (member.stripe_subscription_id && LIVE_SUBSCRIPTION.has(member.subscription_status ?? "")) {
    const priceId = insidersPlusPriceId(tier);
    if (!priceId) return { ok: false, error: `The ${label} price isn't set up in Stripe yet. Nothing was changed.` };
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(member.stripe_subscription_id);
      const item = sub.items.data[0];
      if (!item) return { ok: false, error: "Their Stripe subscription has no plan on it. Nothing was changed." };
      if (item.price.id !== priceId) {
        await stripe.subscriptions.update(sub.id, { items: [{ id: item.id, price: priceId }], proration_behavior: "none" });
      }
      const periodEnd = (item as unknown as { current_period_end?: number }).current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
      message = periodEnd
        ? `${first} is on the ${label} rate. Their next bill, on ${shortDate(periodEnd)}, will be $${price}.`
        : `${first} is on the ${label} rate: $${price}/mo from their next bill.`;
    } catch {
      return { ok: false, error: "Stripe didn't accept the change, so nothing was changed. Try again in a minute." };
    }
  } else if (member.tier === "Insiders+" && member.comped) {
    message = `${first} is on the ${label} rate. Their Insiders+ is comped, so there's no bill to change.`;
  } else {
    message = `${first} is on the ${label} rate. If they join Insiders+, they'll pay $${price}/mo.`;
  }

  const { error: saveErr } = await supabase
    .from("members")
    .update({ price_tier: tier, price_tier_set_by: setBy, price_tier_set_at: new Date().toISOString() })
    .eq("id", memberId);
  if (saveErr) return { ok: false, error: "Their billing was updated, but saving the rate here failed. Press it again to finish." };
  return { ok: true, message };
}
