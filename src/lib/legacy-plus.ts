import type { Member, MemberPriceTier } from "@/lib/types";
import type { BillingInterval } from "@/lib/membership-rates";
import { plusPaidFor } from "@/lib/plus-status";

// Former unlimited members (Andrew, 10/1): about 300 people paid for
// unlimited on the old website (members.legacy_plus). The old site's
// billing (Fortis recurring) never actually charged them and no card came
// over, so nothing is paying for their Insiders+ here, though many believe
// it is. When one checks in or is put on an order, the register says so
// ("No payment on file for unlimited membership") and staff set it up on
// the spot: their card on the reader (pos/legacy-plus-actions.ts), or
// Stripe's page on their own phone from a QR code on the customer screen
// or an emailed link (/membership/finish). If they don't, they're rung up
// like any other guest: no payment, no unlimited.
//
// Andrew's decisions (10/1): the standard Insiders+ price ($15 a month),
// charged today and monthly from today. Senior, student and yearly stay
// available with the usual ID check at the register.
//
// No server imports: the register, the customer screen and Back office
// all use this.

export const LEGACY_DEFAULT_RATE: MemberPriceTier = "adult";
export const LEGACY_DEFAULT_INTERVAL: BillingInterval = "month";

type LegacyFields = Pick<Member, "tier" | "comped" | "stripe_subscription_id" | "subscription_status" | "plus_gift_until"> & {
  legacy_plus?: boolean | null;
  legacy_onboarded_at?: string | null;
};

// Paid for unlimited on the old site, and nothing here is paying for it
// yet: no live subscription, not complimentary, no gifted year. Someone
// set up since (legacy_onboarded_at) never shows again, even if they later
// cancel: they're an ordinary member from then on.
export function legacyNeedsSetup(m: LegacyFields): boolean {
  return !!m.legacy_plus && !m.legacy_onboarded_at && !plusPaidFor(m);
}

export type LegacyOnboardedVia = "reader" | "phone" | "online";
