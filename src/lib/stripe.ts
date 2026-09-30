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
