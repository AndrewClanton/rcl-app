// Proves, in Stripe TEST mode only, what a card added while a member is
// paid ahead does (lib/paid-through.ts, lib/plus-status.ts firstChargeHold):
// the Insiders+ subscription is made the way the app makes it (the yearly
// price, sales tax on the item, the card as default, trial_end at the
// paid-through date), and
//   - nothing is charged now: trialing, a $0 first invoice, no charges
//   - the first real invoice falls on the paid-through date, for the
//     year's price plus tax
// Then it cancels the subscription and deletes the test customer.
//
//   node scripts/check-paid-through-stripe.mjs
//
// Refuses to run with a live key. Touches no member and no database.
import Stripe from "stripe";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_")) {
  console.error("STRIPE_SECRET_KEY isn't a test key. This check only runs in Stripe test mode.");
  process.exit(1);
}
const stripe = new Stripe(key);

// March 13, 2027, noon Central (still CST that day, UTC-6): how
// lib/paid-through.ts stores it.
const PAID_THROUGH = new Date("2027-03-13T18:00:00Z");
const YEAR_PRICE_CENTS = 15300; // ANNUAL_PRICE.adult
const TAX_PERCENT = 8.725; // SALES_TAX_PERCENT

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// The prices and tax rate the app uses (lib/member-rate.ts, lib/stripe-tax.ts).
const price = (await stripe.prices.list({ lookup_keys: ["insiders_plus_adult_yearly"], active: true, limit: 1 })).data[0];
if (!price || price.unit_amount !== YEAR_PRICE_CENTS) {
  console.error("The yearly Insiders+ price (insiders_plus_adult_yearly, $153) isn't in this Stripe test account yet.");
  process.exit(1);
}
let taxRate = null;
for await (const r of stripe.taxRates.list({ active: true, limit: 100 })) {
  if (r.metadata?.rcl === "sales-tax" && r.percentage === TAX_PERCENT && !r.inclusive) {
    taxRate = r.id;
    break;
  }
}
if (!taxRate) {
  console.error("The app's sales tax rate isn't in this Stripe test account yet.");
  process.exit(1);
}

const customer = await stripe.customers.create({
  name: "Paid-through check (test)",
  metadata: { source: "check-paid-through-stripe", test: "1" },
});
let subId = null;
try {
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });

  // As legacy-plus-actions.ts finishFromCard makes it when firstChargeHold
  // gives a date (the online checkout passes the same trial_end).
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id, tax_rates: [taxRate] }],
    default_payment_method: pm.id,
    trial_end: Math.floor(PAID_THROUGH.getTime() / 1000),
    payment_behavior: "error_if_incomplete",
    off_session: true,
    metadata: { source: "check-paid-through-stripe" },
    expand: ["latest_invoice"],
  });
  subId = sub.id;
  const first = sub.latest_invoice;

  check(sub.status === "trialing", `subscription is trialing (got ${sub.status})`);
  check(sub.trial_end === Math.floor(PAID_THROUGH.getTime() / 1000), `trial ends on the paid-through date (${new Date(sub.trial_end * 1000).toISOString()})`);
  check(first && first.amount_due === 0 && first.amount_paid === 0, `first invoice is $0 (due ${(first?.amount_due ?? -1) / 100}, paid ${(first?.amount_paid ?? -1) / 100})`);
  const charges = await stripe.charges.list({ customer: customer.id, limit: 10 });
  check(charges.data.length === 0, `no charges on the card now (${charges.data.length})`);
  const intents = await stripe.paymentIntents.list({ customer: customer.id, limit: 10 });
  check(intents.data.length === 0, `no payment attempts now (${intents.data.length})`);

  // The next invoice Stripe will make: when, and for how much.
  const next = await stripe.invoices.createPreview({ customer: customer.id, subscription: sub.id });
  const at = new Date((next.period_end ?? next.created) * 1000);
  const line = next.lines.data[0];
  const lineStart = line?.period?.start ? new Date(line.period.start * 1000) : null;
  const expectTotal = YEAR_PRICE_CENTS + Math.round((YEAR_PRICE_CENTS * TAX_PERCENT) / 100);
  check(lineStart?.getTime() === PAID_THROUGH.getTime(), `first real bill starts the year on ${lineStart?.toISOString()} (the paid-through date)`);
  check(next.subtotal === YEAR_PRICE_CENTS, `first real bill is $153 before tax (got ${next.subtotal / 100})`);
  check(Math.abs(next.total - expectTotal) <= 1, `with tax on top: $${(next.total / 100).toFixed(2)} (expected about $${(expectTotal / 100).toFixed(2)})`);
  console.log(`     next invoice dated ${at.toISOString()}`);
} finally {
  if (subId) await stripe.subscriptions.cancel(subId).catch((e) => console.error(`couldn't cancel ${subId}: ${e.message}`));
  const gone = await stripe.customers.del(customer.id).catch((e) => ({ deleted: false, error: e.message }));
  console.log(gone.deleted ? "cleaned up: subscription cancelled, test customer deleted" : `cleanup problem: ${gone.error}`);
}
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
