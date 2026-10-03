// Reads every Insiders+ card charge, gift membership and refund of either
// from Stripe into member_payments (what Reports count), from launch (or
// --since) on. The same code the site runs (src/lib/membership-payments/
// engine.ts), so what this saves is exactly what the site would. Stripe is
// only read, never changed.
//
// A dry run by default: nothing is saved, and the database isn't touched at
// all (it works before the member payments migration is applied). It prints
// what would be saved, added up per business day by kind and plan, with the
// tax. Ids, amounts and plans only: no names or emails.
//
// Usage:
//   node scripts/backfill-member-payments.mjs                     dry run from launch (Sept. 14)
//   node scripts/backfill-member-payments.mjs --since 2026-09-20  from that day (4 AM Central)
//   node scripts/backfill-member-payments.mjs --list              also each payment, one per line
//   node scripts/backfill-member-payments.mjs --apply             save them (needs migration
//                                                                 20261001110000_member_payments.sql)
//   --allow-test   with Stripe's test key: count test-mode payments. A dry run
//                  shows them anyway (marked as test); --apply refuses without it,
//                  since .env.local pairs the test key with the real database.
//
// Node 23.6+ runs the .ts files directly (types are stripped); the hook below
// resolves the site's "@/..." imports and extensionless ".ts" ones.

import { registerHooks } from "node:module";
import { config } from "dotenv";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

// Node notes that the .ts files have no "type": "module" to go by; that's
// expected here, so only other warnings are shown.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON" && w.name !== "ExperimentalWarning") console.warn(`${w.name}: ${w.message}`);
});

const SRC = new URL("../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return next(spec, context);
    } catch (e) {
      if (/^(\.{1,2}\/|file:)/.test(spec) && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, context);
      throw e;
    }
  },
});

const { LAUNCH, businessDateOf, planLabel } = await import("../src/lib/membership-payments/rows.ts");
const { dryRunStore, giftsFromStripe, loadPlusContext, lockedSync, runPaymentSync, supabaseStore } = await import("../src/lib/membership-payments/engine.ts");

// ---------- arguments ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = flag("--apply");
const list = flag("--list");
const allowTestFlag = flag("--allow-test");
const sinceArg = value("--since");
if (flag("--write")) {
  console.error("Use --apply to save (--write isn't a thing here).");
  process.exit(1);
}

// --since 2026-09-20: that business day's start, 4 AM Central (CDT until Nov. 1).
function dayStart(date) {
  for (const offset of ["-05:00", "-06:00"]) {
    const t = new Date(`${date}T04:00:00${offset}`);
    if (businessDateOf(t) === date && businessDateOf(new Date(t.getTime() - 1)) !== date) return t.toISOString();
  }
  return new Date(`${date}T04:00:00-05:00`).toISOString();
}
if (sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) {
  console.error("--since takes a date like 2026-09-20.");
  process.exit(1);
}
const since = sinceArg ? dayStart(sinceArg) : LAUNCH;

// ---------- Stripe ----------
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local");
  process.exit(1);
}
const keyMode = /^(sk|rk)_live_/.test(key) ? "live" : "test";
console.log(`Stripe key: ${keyMode.toUpperCase()} mode${keyMode === "test" ? " (test payments only; the live ones need the live key, which is in Vercel)" : ""}.`);
if (apply && keyMode === "test" && !allowTestFlag) {
  console.error("Refusing to save with the test key: .env.local points at the real database. (--allow-test to do it anyway, for a test database.)");
  process.exit(1);
}
const allowTest = allowTestFlag || (!apply && keyMode === "test");
// Like the site's sync: a call that hangs gives up after 10 s, tried once more.
const stripe = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });
const monthlyIds = {
  adult: process.env.STRIPE_PRICE_INSIDERS_PLUS_ADULT,
  senior: process.env.STRIPE_PRICE_INSIDERS_PLUS_SENIOR,
  student: process.env.STRIPE_PRICE_INSIDERS_PLUS_STUDENT,
};

async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.type === "StripeConnectionError" || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT") {
      console.warn("Network hiccup; trying once more.");
      return fn();
    }
    throw e;
  }
}

const ctx = await withRetry(() => loadPlusContext(stripe, monthlyIds));
if (!ctx.productId) {
  console.error("Couldn't find the Royale Insiders+ product on this Stripe account.");
  process.exit(1);
}
console.log(`Insiders+ product ${ctx.productId}, ${ctx.prices.size} prices (monthly and yearly, old ones too).`);

// ---------- apply ----------
if (apply) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed in .env.local to save.");
    process.exit(1);
  }
  const db = createClient(url, service, { auth: { persistSession: false } });
  // With the test key, the shared "last read" row (member_payment_sync) is
  // left alone: the real site's reads go by it, and .env.local points at the
  // real database. Only a live-key run claims it and moves its marks.
  const shared = keyMode === "live";
  console.log(`Saving everything from ${since}...${shared ? "" : " (test key: the site's last-read marks are left alone)"}`);
  const r = await lockedSync(db, async () => ({ stripe, store: supabaseStore(db), ctx, allowTest }), { mode: "backfill", since, force: true, shared });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok && !r.skipped ? 0 : 1);
}

// ---------- dry run ----------
console.log(`Dry run: reading from ${since}${since === LAUNCH ? " (launch)" : ""}. Nothing is saved.\n`);
const gifts = await withRetry(() => giftsFromStripe(stripe, since));
const store = dryRunStore(gifts);
const counts = await withRetry(() => runPaymentSync({ stripe, store, ctx, allowTest }, since));
const rows = store.rows;

const money = (cents) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const KIND = { plus_new: "New", plus_renewal: "Renewal", plus_switch: "Switch to yearly", plus_change: "Plan change", gift: "Gift", refund: "Refund" };
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log(`Read: ${counts.invoices} paid invoice(s) on the account since then, ${gifts.length} paid gift checkout(s).`);
console.log(`Skipped: ${counts.skipped.nothingCharged} invoice(s) that charged nothing ($0: a card saved for a later first charge, 100% off)${counts.skipped.testMode ? `, ${counts.skipped.testMode} test-mode` : ""}.`);
if (keyMode === "test" && !apply) console.log("TEST MODE: these are test payments, shown to check the rules. None are real.");
for (const w of counts.warnings) console.log(`Warning: ${w}`);
console.log("");

if (!rows.length) {
  console.log("Nothing to save.");
} else {
  // Per business day, by kind and plan.
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.business_date}|${KIND[r.kind]}|${r.kind === "gift" ? "a year (gift)" : r.product === "gift" ? "gift" : planLabel(r.tier, r.billing_interval)}`;
    const g = groups.get(k) ?? { n: 0, amount: 0, sales: 0, tax: 0 };
    g.n++;
    g.amount += r.amount_cents;
    g.sales += r.sales_cents;
    g.tax += r.tax_cents;
    groups.set(k, g);
  }
  console.log(`${pad("Business day", 13)}${pad("Kind", 18)}${pad("Plan", 17)}${lpad("Count", 6)}${lpad("Collected", 12)}${lpad("Before tax", 12)}${lpad("Tax", 9)}`);
  for (const [k, g] of [...groups.entries()].sort()) {
    const [date, kind, plan] = k.split("|");
    console.log(`${pad(date, 13)}${pad(kind, 18)}${pad(plan, 17)}${lpad(g.n, 6)}${lpad(money(g.amount), 12)}${lpad(money(g.sales), 12)}${lpad(money(g.tax), 9)}`);
  }

  const byKind = new Map();
  for (const r of rows) {
    const g = byKind.get(KIND[r.kind]) ?? { n: 0, amount: 0, tax: 0 };
    g.n++;
    g.amount += r.amount_cents;
    g.tax += r.tax_cents;
    byKind.set(KIND[r.kind], g);
  }
  console.log("");
  console.log(`By kind: ${[...byKind.entries()].map(([k, g]) => `${k} ${g.n} (${money(g.amount)}, tax ${money(g.tax)})`).join("; ")}`);
  const total = rows.reduce((s, r) => ({ amount: s.amount + r.amount_cents, sales: s.sales + r.sales_cents, tax: s.tax + r.tax_cents }), { amount: 0, sales: 0, tax: 0 });
  const payments = rows.filter((r) => r.kind !== "refund").length;
  console.log(`Total: ${payments} payment(s), ${rows.length - payments} refund(s): ${money(total.amount)} collected = ${money(total.sales)} before tax + ${money(total.tax)} tax.`);
  const live = rows.filter((r) => r.livemode).length;
  console.log(`Live: ${live}, test: ${rows.length - live}. Reports count live ones only.`);
}

if (store.ends.length) {
  const ends = new Map();
  for (const e of store.ends) ends.set(e.business_date, (ends.get(e.business_date) ?? 0) + 1);
  console.log(`\nInsiders+ subscriptions that ended (Stripe keeps these events 30 days): ${[...ends.entries()].sort().map(([d, n]) => `${d}: ${n}`).join(", ")}.`);
}

if (list && rows.length) {
  console.log("\nEach payment:");
  for (const r of [...rows].sort((a, b) => a.counted_at.localeCompare(b.counted_at) || a.source_id.localeCompare(b.source_id))) {
    console.log(
      `${r.business_date}  ${pad(r.source_id, 46)}${pad(KIND[r.kind], 18)}${pad(planLabel(r.tier, r.billing_interval), 17)}${lpad(money(r.amount_cents), 10)}${lpad(money(r.tax_cents), 9)}  ${r.billing_reason ?? ""}${r.livemode ? "" : " (test)"}`,
    );
  }
}
