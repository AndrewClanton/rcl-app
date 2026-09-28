import type { Member } from "@/lib/types";

type BillingFields = Pick<Member, "tier" | "comped" | "stripe_subscription_id" | "subscription_status">;

// Two different questions about Insiders+:
// - hasPlusPerks: do they get free entry and the rest right now? (the tier)
// - plusPaidFor: is it covered -- complimentary, or a Stripe subscription
//   we're still collecting on? If so, another checkout would be a second
//   membership.
// Staff can also set someone to Insiders+ by hand at the register. That
// member has the perks but nothing paying for them, so they're offered
// "add a card" everywhere instead of being told they're all set.
// (No server-only imports: the admin and account screens use these too.)
export function hasPlusPerks(member: Pick<Member, "tier">): boolean {
  return member.tier === "Insiders+";
}

export function plusPaidFor(member: BillingFields): boolean {
  if (member.comped) return true;
  return !!member.stripe_subscription_id && ["active", "trialing", "past_due", "unpaid"].includes(member.subscription_status ?? "");
}

// Insiders+ set by hand, with no card or complimentary flag behind it.
export function plusNeedsCard(member: BillingFields): boolean {
  return hasPlusPerks(member) && !plusPaidFor(member);
}
