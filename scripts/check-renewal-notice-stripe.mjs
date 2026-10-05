// Proves, in Stripe TEST mode only, which renewals the yearly renewal
// notice picks (lib/renewal-notice.ts). It makes yearly Insiders+
// subscriptions the way the app does (the yearly price, sales tax on the
// item, a Visa 4242 as the card) on one test customer:
//   - active, renewing in 7 days          picked
//   - active, renewing in 6 days          not picked
//   - active, renewing in 8 days          not picked
//   - trialing (paid through), 7 days     picked
//   - active, 7 days, set to cancel       not picked
// and checks the email has the real figures from Stripe's upcoming invoice,
// then runs again to show nothing goes twice. The send is a stub (no email
// goes anywhere) and the member is a stand-in. Afterwards it removes its
// renewal_notices rows, cancels the subscriptions and deletes the customer.
//
//   node scripts/check-renewal-notice-stripe.mjs
//
// Refuses to run with a live key.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import Stripe from "stripe";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(ROOT, ".env.local"), quiet: true });
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_")) {
  console.error("STRIPE_SECRET_KEY isn't a test key. This check only runs in Stripe test mode.");
  process.exit(1);
}

const SRC = join(ROOT, "src");
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const f = withExt(join(SRC, specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[a-z]+$/i.test(specifier)) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(SRC)) {
        const f = withExt(resolve(dirname(parent), specifier));
        if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});
const lib = (p) => import(pathToFileURL(join(SRC, p)).href);
const { runRenewalNotices } = await lib("lib/renewal-notice.ts");
const { businessDay, centralToIso, shiftDate } = await lib("lib/ops/time.ts");
const { createAdminClient } = await lib("lib/supabase/admin.ts");

const stripe = new Stripe(key);
const db = createAdminClient();
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

const price = (await stripe.prices.list({ lookup_keys: ["insiders_plus_adult_yearly"], active: true, limit: 1 })).data[0];
if (!price || price.unit_amount !== 15300) {
  console.error("The yearly Insiders+ price (insiders_plus_adult_yearly, $153) isn't in this Stripe test account yet.");
  process.exit(1);
}
let taxRate = null;
for await (const r of stripe.taxRates.list({ active: true, limit: 100 })) {
  if (r.metadata?.rcl === "sales-tax" && !r.inclusive) {
    taxRate = r;
    break;
  }
}
const today = businessDay().date;
// Noon Central, `days` after today's business day, as a Stripe time.
const at = (days) => Math.floor(Date.parse(centralToIso(shiftDate(today, days), "12:00")) / 1000);

const customer = await stripe.customers.create({ name: "Renewal notice check", metadata: { rcl: "renewal-notice-check" } });
const subs = {};
try {
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  const item = { price: price.id, ...(taxRate ? { tax_rates: [taxRate.id] } : {}) };
  const make = (extra) => stripe.subscriptions.create({ customer: customer.id, items: [item], default_payment_method: pm.id, metadata: { rcl: "renewal-notice-check" }, ...extra });
  const anchored = (days, extra = {}) => make({ billing_cycle_anchor: at(days), proration_behavior: "none", ...extra });
  subs.in7 = await anchored(7);
  subs.in6 = await anchored(6);
  subs.in8 = await anchored(8);
  subs.trial7 = await make({ trial_end: at(7) });
  subs.cancel7 = await anchored(7, { cancel_at_period_end: true });
  check(subs.in7.status === "active" && subs.trial7.status === "trialing", "made: active ones and a trialing one");

  const ids = new Set(Object.values(subs).map((s) => s.id));
  const memberId = randomUUID();
  const sent = [];
  const run = () =>
    runRenewalNotices({
      stripe,
      only: (s) => ids.has(s.id),
      memberFor: async () => ({ id: memberId, name: "Jake Check", email: "renewal-check@example.invalid" }),
      send: async (to, subject, html, opts) => {
        sent.push({ to, subject, html, text: opts?.text ?? "" });
        return { ok: true, id: `stub_${sent.length}` };
      },
    });

  const first = await run();
  check(first.checked === 5, `looked at all 5 test subscriptions (${first.checked})`);
  check(first.due === 2 && first.sent === 2, `2 due and sent (${first.due} due, ${first.sent} sent)`);
  const { data: rows } = await db.from("renewal_notices").select("stripe_subscription_id, sent_at, resend_id, charge_date").in("stripe_subscription_id", [...ids]);
  const noticed = new Set((rows ?? []).map((r) => r.stripe_subscription_id));
  check(noticed.has(subs.in7.id), "active, renewing in 7 days: picked");
  check(!noticed.has(subs.in6.id), "active, renewing in 6 days: not picked");
  check(!noticed.has(subs.in8.id), "active, renewing in 8 days: not picked");
  check(noticed.has(subs.trial7.id), "trialing (paid through), first charge in 7 days: picked");
  check(!noticed.has(subs.cancel7.id), "set to cancel, 7 days: not picked");
  check((rows ?? []).every((r) => r.sent_at && r.resend_id?.startsWith("stub_") && r.charge_date === shiftDate(today, 7)), "each row has sent_at, the Resend id and the charge date");

  // The figures are Stripe's own: the upcoming invoice for the 7-day one.
  const preview = await stripe.invoices.createPreview({ customer: customer.id, subscription: subs.in7.id });
  const dollars = (c) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
  const excl = preview.total_excluding_tax ?? preview.subtotal;
  const want = preview.total > excl ? `${dollars(excl)} + ${dollars(preview.total - excl)} tax = ${dollars(preview.total)}` : dollars(preview.total);
  console.log(`     upcoming invoice: ${want}`);
  check(sent.length === 2 && sent.every((s) => s.text.includes(want) && s.html.includes(want.replace(/&/g, "&amp;"))), `both emails say ${want}`);
  check(sent.every((s) => s.text.includes("Visa ending 4242")), "both emails name the Visa ending 4242");
  check(sent.every((s) => /^Your Insiders\+ year renews on [A-Z][a-z]+ \d+$/.test(s.subject)), `subject: "${sent[0]?.subject}"`);
  check(sent.every((s) => s.text.includes(`Manage or cancel: https://www.royalecinemajoplin.com/account/login?next=${encodeURIComponent("/account/billing")}`) && s.text.includes("The Royale crew")), "Manage or cancel link to Billing, signed by the crew");

  const second = await run();
  check(second.sent === 0 && second.already === 2 && sent.length === 2, `rerun sends nothing again (${second.sent} sent, ${second.already} already)`);
} finally {
  const ids = Object.values(subs).map((s) => s.id);
  if (ids.length) await db.from("renewal_notices").delete().in("stripe_subscription_id", ids);
  for (const s of Object.values(subs)) await stripe.subscriptions.cancel(s.id).catch(() => null);
  await stripe.customers.del(customer.id).catch(() => null);
  const { count } = await db.from("renewal_notices").select("id", { count: "exact", head: true }).in("stripe_subscription_id", ids.length ? ids : ["none"]);
  console.log(`cleaned up: ${ids.length} test subscriptions canceled, customer deleted, ${count ?? "?"} rows left`);
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
