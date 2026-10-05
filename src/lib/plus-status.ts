import type { Member } from "@/lib/types";

type BillingFields = Pick<Member, "tier" | "comped" | "stripe_subscription_id" | "subscription_status" | "plus_gift_until">;

// Two different questions about Insiders+:
// - hasPlusPerks: do they get free entry and the rest right now? (the tier)
// - plusPaidFor: is it covered -- complimentary, a Stripe subscription
//   we're still collecting on, or a gifted year that hasn't run out? If
//   so, another checkout would be a second membership.
// Staff can also set someone to Insiders+ by hand at the register. That
// member has the perks but nothing paying for them, so they're offered
// "add a card" everywhere instead of being told they're all set.
// (No server-only imports: the admin and account screens use these too.)
export function hasPlusPerks(member: Pick<Member, "tier">): boolean {
  return member.tier === "Insiders+";
}

// A Stripe subscription that's still billing them (or waiting on a first
// charge staff scheduled).
export function subscriptionLive(member: Pick<Member, "stripe_subscription_id" | "subscription_status">): boolean {
  return !!member.stripe_subscription_id && ["active", "trialing", "past_due", "unpaid"].includes(member.subscription_status ?? "");
}

// A gifted year (see lib/gift-membership.ts), or a year prepaid another way
// (lib/paid-through.ts: the same column), that hasn't run out yet.
export function giftActive(member: Pick<Member, "plus_gift_until">, now = Date.now()): boolean {
  return !!member.plus_gift_until && new Date(member.plus_gift_until).getTime() > now;
}

export function plusPaidFor(member: BillingFields): boolean {
  if (member.comped) return true;
  return subscriptionLive(member) || giftActive(member);
}

// Covered by a gift with nothing lined up after it: they can sign up now,
// and the first charge waits until the gift runs out. The gift's end date,
// or null.
export function giftEndsWithoutRenewal(member: BillingFields): string | null {
  if (member.comped || subscriptionLive(member) || !giftActive(member)) return null;
  return member.plus_gift_until ?? null;
}

// Stripe holds a new subscription's first charge only 48+ hours out.
export const MIN_HOLD_MS = 49 * 3_600_000;

// When a card added now should first be charged: the end of a gifted or
// prepaid year (plus_gift_until, lib/paid-through.ts) with nothing lined up
// after it, so they're never charged for time already paid. Null: charge
// today (nothing covers them, or it ends within 2 days).
export function firstChargeHold(member: BillingFields, now = Date.now()): Date | null {
  const ends = giftEndsWithoutRenewal(member);
  if (!ends) return null;
  const at = new Date(ends);
  return at.getTime() > now + MIN_HOLD_MS ? at : null;
}

// A card can go on for Insiders+ now: nothing pays for it, or a gifted or
// prepaid year with nothing after it (then the first charge waits).
export function canAddPlusCard(member: BillingFields): boolean {
  if (member.comped) return false;
  return !plusPaidFor(member) || !!giftEndsWithoutRenewal(member);
}

// Insiders+ set by hand, with no card or complimentary flag behind it.
export function plusNeedsCard(member: BillingFields): boolean {
  return hasPlusPerks(member) && !plusPaidFor(member);
}
