import "server-only";

// Which Stripe payments this server reads into member_payments: live ones,
// with the live key. A laptop's .env.local has Stripe's test key but the
// real database, and test payments must never land in the real reports, so
// with a test key nothing is read or counted. MEMBER_PAYMENTS_ALLOW_TEST=1
// lifts that, for a test database.

export function stripeKeyMode(): "live" | "test" | "none" {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return key ? "test" : "none";
}

export function allowTestPayments(): boolean {
  return process.env.MEMBER_PAYMENTS_ALLOW_TEST === "1";
}

export function paymentsSyncAllowed(): boolean {
  const mode = stripeKeyMode();
  return mode === "live" || (mode === "test" && allowTestPayments());
}

// The livemode values Reports count: live only, unless test ones are allowed.
export function countedModes(): boolean[] {
  return allowTestPayments() ? [true, false] : [true];
}
