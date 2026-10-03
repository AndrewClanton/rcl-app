import "server-only";
import Stripe from "stripe";

// Which kind of Stripe key this server has: "live" takes real payments,
// "test" is for trying things out. Null when there's no key.
export function stripeKeyMode(): "live" | "test" | null {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return /^(sk|rk)_live_/.test(key) ? "live" : /^(sk|rk)_test_/.test(key) ? "test" : null;
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key);
}

// For a quick, optional read while someone waits (the card on a register
// sale, lib/member-cards.ts): gives up after a few seconds with no retries,
// instead of the SDK's 80-second wait, so a slow Stripe can't keep the
// server busy on something the sale doesn't need.
export function getQuickStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key, { timeout: 5000, maxNetworkRetries: 0 });
}
