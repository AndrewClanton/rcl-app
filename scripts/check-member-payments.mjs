// Checks the member payments rules (src/lib/membership-payments/rows.ts)
// and the sync's steps (engine.ts) without Stripe or a database: plain
// objects shaped like Stripe's (API 2026-08-26.dahlia) and an in-memory
// store with the table's unique source_id.
//  1. The business day a payment counts on: the 4 a.m. Central edge, a
//     sale after midnight on the last night of a month, both nights the
//     clocks change.
//  2. What a price is (tier, monthly or yearly).
//  3. An invoice as a row: new, renewal, switch to yearly, the $0 invoice a
//     card saved for a later first charge makes, other products, unpaid.
//  4. Gifts, refunds (their tax, their day, netting), payment status.
//  5. Adding up: the Reports lines, "1 new yearly · 2 renewals".
//  6. The sync end to end: a first charge after a free start is new, a
//     cycle after a paid one is a renewal, running twice or two at once
//     never counts a payment twice, a saved row keeps its kind, refunds
//     come off their payment's day, a failed refund goes away, test-mode
//     payments are left out.
//  7. Round 2: partial refunds give back exactly the charge's tax, a plan
//     change isn't a switch to yearly, a price newer than the cached list
//     is looked up, an invoice paid days after it was made is found by a
//     quick read, gifts are saved even when Stripe can't be read, a run
//     out of time stops, and the claim: only the run holding it writes the
//     state row, and a test-key run never touches it.
//
// Usage: node scripts/check-member-payments.mjs   (Node 23.6+ runs the .ts directly)

import { registerHooks } from "node:module";

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

const rows = await import("../src/lib/membership-payments/rows.ts");
const engine = await import("../src/lib/membership-payments/engine.ts");
const { businessDateOf, priceInfo, readPlusInvoice, plusKind, giftRow, refundRow, refundTaxCents, paymentStatus, summarizeMemberships, membershipsDetail, paymentLabel, lineKey } = rows;
const { runPaymentSync, lockedSync, syncFrom, syncRunning, LOCK_SECONDS, RUN_SECONDS } = engine;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---------- 1. the business day ----------
// Central is UTC-5 in daylight time (CDT), UTC-6 in standard time (CST).
const cdt = (date, time) => new Date(`${date}T${time}:00-05:00`);
const cst = (date, time) => new Date(`${date}T${time}:00-06:00`);

eq("3:59 AM counts on the day before", businessDateOf(cdt("2026-09-29", "03:59")), "2026-09-28");
eq("4:00 AM starts the day", businessDateOf(cdt("2026-09-29", "04:00")), "2026-09-29");
eq("the annual sale (about 10:35 AM Tue 9/29)", businessDateOf(cdt("2026-09-29", "10:35")), "2026-09-29");
eq("11:30 PM counts tonight", businessDateOf(cdt("2026-09-29", "23:30")), "2026-09-29");
eq("1 AM after the last night of September stays in September", businessDateOf(cdt("2026-10-01", "01:00")), "2026-09-30");
eq("as an ISO string too", businessDateOf("2026-10-01T06:59:59.000Z"), "2026-09-30");
eq("as unix milliseconds too", businessDateOf(cdt("2026-10-01", "04:00").getTime()), "2026-10-01");
// Fall back, Sun Nov 1 2026: 2 AM CDT becomes 1 AM CST.
eq("fall back: 1:30 AM CDT (first time round)", businessDateOf(cdt("2026-11-01", "01:30")), "2026-10-31");
eq("fall back: 1:30 AM CST (second time round)", businessDateOf(cst("2026-11-01", "01:30")), "2026-10-31");
eq("fall back: 3:59 AM CST is still Saturday's", businessDateOf(cst("2026-11-01", "03:59")), "2026-10-31");
eq("fall back: 4:00 AM CST starts Sunday (a 25-hour Saturday)", businessDateOf(cst("2026-11-01", "04:00")), "2026-11-01");
// Spring forward, Sun Mar 14 2027: 2 AM CST becomes 3 AM CDT.
eq("spring forward: 1:59 AM CST is Saturday's", businessDateOf(cst("2027-03-14", "01:59")), "2027-03-13");
eq("spring forward: 3:00 AM CDT is Saturday's", businessDateOf(cdt("2027-03-14", "03:00")), "2027-03-13");
eq("spring forward: 4:00 AM CDT starts Sunday (a 23-hour Saturday)", businessDateOf(cdt("2027-03-14", "04:00")), "2027-03-14");
eq("winter: 4:00 AM CST", businessDateOf(cst("2027-01-15", "04:00")), "2027-01-15");
eq("winter: 3:59 AM CST", businessDateOf(cst("2027-01-15", "03:59")), "2027-01-14");

// ---------- 2. prices ----------
const monthlyIds = { adult: "price_m_adult", senior: "price_m_senior", student: "price_m_student" };
eq("yearly by lookup key", priceInfo({ id: "price_x", lookup_key: "insiders_plus_senior_yearly", unit_amount: 12240, recurring: { interval: "year" } }, monthlyIds), { tier: "senior", interval: "year" });
eq("monthly by the site's price id", priceInfo({ id: "price_m_student", unit_amount: 1000, recurring: { interval: "month" } }, monthlyIds), { tier: "student", interval: "month" });
eq("an old price by its amount", priceInfo({ id: "price_old", unit_amount: 15300, recurring: { interval: "year" } }, monthlyIds), { tier: "adult", interval: "year" });
eq("an unknown amount: plan only", priceInfo({ id: "price_odd", unit_amount: 999, recurring: { interval: "month" } }, monthlyIds), { tier: null, interval: "month" });

// ---------- 3. invoices ----------
const PROD = "prod_plus";
const ctx = {
  productId: PROD,
  prices: new Map([
    ["price_m_adult", { tier: "adult", interval: "month" }],
    ["price_m_senior", { tier: "senior", interval: "month" }],
    ["price_y_adult", { tier: "adult", interval: "year" }],
  ]),
};
const unix = (d) => Math.floor(d.getTime() / 1000);
const line = (price, amount, start, end, proration = false) => ({
  amount,
  period: { start: unix(start), end: unix(end) },
  pricing: { price_details: { price, product: PROD } },
  parent: { subscription_item_details: { proration } },
});
function invoice({ id, sub = "sub_1", customer = "cus_1", reason = "subscription_create", paidAt, amount, tax = 0, excl, total, lines, pi = `pi_${id}`, livemode = true, status = "paid", created }) {
  return {
    id,
    customer,
    livemode,
    status,
    billing_reason: reason,
    amount_paid: amount,
    total: total ?? amount,
    total_excluding_tax: excl ?? amount - tax,
    total_taxes: tax ? [{ amount: tax }] : [],
    created: created ?? unix(paidAt),
    status_transitions: { paid_at: unix(paidAt) },
    parent: { type: "subscription_details", subscription_details: { subscription: sub } },
    lines: { data: lines },
    payments: { data: [{ status: "paid", payment: { payment_intent: pi } }] },
  };
}

const monthStart = cdt("2026-09-28", "18:05");
const monthEnd = cdt("2026-10-28", "18:05");
const create = invoice({ id: "in_new", paidAt: monthStart, amount: 1631, tax: 131, lines: [line("price_m_adult", 1500, monthStart, monthEnd)] });
let r = readPlusInvoice(create, ctx);
eq("a new monthly: row", [r.row?.kind, r.row?.tier, r.row?.billing_interval, r.row?.amount_cents, r.row?.sales_cents, r.row?.tax_cents], ["plus_new", "adult", "month", 1631, 1500, 131]);
eq("a new monthly: its day, next bill, payment", [r.row?.business_date, r.row?.period_end, r.row?.stripe_payment_intent_id, r.row?.stripe_subscription_id], ["2026-09-28", monthEnd.toISOString(), "pi_in_new", "sub_1"]);

const trialZero = invoice({ id: "in_trial", paidAt: cdt("2026-09-29", "12:00"), amount: 0, lines: [line("price_m_adult", 0, cdt("2026-09-29", "12:00"), cdt("2026-10-05", "12:00"))] });
eq("the $0 invoice for a card saved for later is skipped", readPlusInvoice(trialZero, ctx), { skip: "nothing_charged" });

const yearStart = cdt("2026-09-28", "21:40");
const yearEnd = cdt("2027-09-28", "21:40");
const switchInv = invoice({
  id: "in_switch",
  reason: "subscription_update",
  paidAt: yearStart,
  amount: 15004,
  tax: 1204,
  excl: 13800,
  lines: [line("price_m_adult", -1500, yearStart, monthEnd, true), line("price_y_adult", 15300, yearStart, yearEnd)],
});
r = readPlusInvoice(switchInv, ctx);
eq("a switch to yearly: kind, plan, money", [r.row?.kind, r.row?.billing_interval, r.row?.amount_cents, r.row?.sales_cents, r.row?.tax_cents], ["plus_switch", "year", 15004, 13800, 1204]);
eq("a switch to yearly: covers the year", r.row?.period_end, yearEnd.toISOString());

eq("not Insiders+: another product", readPlusInvoice({ ...create, lines: { data: [{ ...line("price_other", 900, monthStart, monthEnd), pricing: { price_details: { price: "price_other", product: "prod_other" } } }] } }, ctx), { skip: "not_plus" });
eq("not Insiders+: not a subscription", readPlusInvoice({ ...create, parent: { type: "quote_details" } }, ctx), { skip: "not_plus" });
eq("not paid", readPlusInvoice({ ...create, status: "open" }, ctx), { skip: "unpaid" });
const balance = readPlusInvoice(invoice({ id: "in_bal", paidAt: monthStart, amount: 1000, total: 1631, tax: 131, excl: 1500, lines: [line("price_m_adult", 1500, monthStart, monthEnd)] }), ctx);
eq("part paid from a customer balance: money in is what was charged", [balance.row?.amount_cents, balance.row?.sales_cents, balance.row?.tax_cents], [1000, 1500, 131]);

eq("kind: sign-up is new", plusKind("subscription_create", true), "plus_new");
eq("kind: a cycle after a paid charge is a renewal", plusKind("subscription_cycle", true), "plus_renewal");
eq("kind: a cycle with nothing paid before is new (first charge after a free start or a gift)", plusKind("subscription_cycle", false), "plus_new");
eq("kind: a switch to yearly after a paid charge", plusKind("subscription_update", true, true), "plus_switch");
eq("kind: another plan change after a paid charge", plusKind("subscription_update", true, false), "plus_change");
eq("kind: a switch before any charge is new", plusKind("subscription_update", false, true), "plus_new");

// Adult monthly to senior monthly, prorated (say, from the Stripe dashboard): not a switch to yearly.
const changeAt = cdt("2026-10-10", "12:00");
const planChange = invoice({
  id: "in_change",
  reason: "subscription_update",
  paidAt: changeAt,
  amount: 100,
  tax: 8,
  excl: 92,
  lines: [line("price_m_adult", -900, changeAt, monthEnd, true), line("price_m_senior", 992, changeAt, monthEnd, true)],
});
r = readPlusInvoice(planChange, ctx);
eq("a prorated monthly-to-monthly plan change: plus_change, the new plan", [r.row?.kind, r.row?.tier, r.row?.billing_interval], ["plus_change", "senior", "month"]);
eq("...its label", paymentLabel(r.row), "Plan change · Senior monthly");
// A yearly charge on subscription_update with no monthly line (a trialing
// monthly moved to yearly before its first charge): not a switch.
r = readPlusInvoice(invoice({ id: "in_y", reason: "subscription_update", paidAt: yearStart, amount: 16635, tax: 1335, lines: [line("price_y_adult", 15300, yearStart, yearEnd)] }), ctx);
eq("a yearly charge with no monthly credit isn't a switch", r.row?.kind, "plus_change");

// ---------- 4. gifts, refunds ----------
const gift = { id: "g1", recipient_member_id: "m2", price: "153.00", tax_amount: "13.35", paid_at: "2026-09-30T03:10:00.000Z", starts_at: null, ends_at: null, stripe_payment_intent_id: "pi_gift", stripe_checkout_session_id: "cs_live_abc" };
const g = giftRow(gift);
eq("a gift: money in cents", [g.source_id, g.kind, g.amount_cents, g.sales_cents, g.tax_cents], ["gift:g1", "gift", 16635, 15300, 1335]);
eq("a gift at 10:10 PM counts that night", g.business_date, "2026-09-29");
eq("a gift's live or test from its payment page", [g.livemode, giftRow({ ...gift, stripe_checkout_session_id: "cs_test_x" }).livemode, giftRow({ ...gift, stripe_checkout_session_id: null }).livemode], [true, false, true]);

const paid = { ...readPlusInvoice(create, ctx).row, id: "row_new" };
eq("refund tax, no credit note: the payment's share", refundTaxCents(800, paid), 64);
eq("refund tax of a whole payment", refundTaxCents(1631, paid), 131);
{
  // $16.31 ($1.31 tax) refunded as $5.43 + $5.44 + $5.44: each alone rounds
  // to 44 (132 in all); on the running total it's 44 + 43 + 44 = 131.
  const a = refundTaxCents(543, paid);
  const b = refundTaxCents(544, paid, { amount: 543, tax: a });
  const c = refundTaxCents(544, paid, { amount: 1087, tax: a + b });
  eq("three partial refunds give back exactly the charge's tax", [a, b, c, a + b + c], [44, 43, 44, 131]);
  eq("refund tax never more than the refund, never below zero", [refundTaxCents(1, paid, { amount: 0, tax: 0 }), refundTaxCents(100, paid, { amount: 1631, tax: 131 })], [0, 0]);
}
const refundAt = cdt("2026-10-03", "15:00");
const re = refundRow({ id: "re_1", amount: 800, created: unix(refundAt), status: "succeeded", payment_intent: "pi_in_new" }, paid, refundTaxCents(800, paid));
eq("a refund: negative", [re.kind, re.amount_cents, re.sales_cents, re.tax_cents], ["refund", -800, -736, -64]);
eq("a refund comes off its payment's day", [re.business_date, re.counted_at, re.refund_of], [paid.business_date, paid.counted_at, "row_new"]);
eq("a refund: when it was made is kept", re.paid_at, refundAt.toISOString());
eq("payment status", [paymentStatus(1631, 0), paymentStatus(1631, 800), paymentStatus(1631, 1631)], ["paid", "partly_refunded", "refunded"]);

// ---------- 5. adding up ----------
const renewal = { ...paid, kind: "plus_renewal", amount_cents: 1631, sales_cents: 1500, tax_cents: 131 };
const yearly = { ...paid, kind: "plus_new", billing_interval: "year", amount_cents: 16635, sales_cents: 15300, tax_cents: 1335 };
const t = summarizeMemberships([paid, re, renewal, renewal, yearly, g]);
eq("totals net of the refund", [t.collected, t.sales, t.tax, t.refunded], [(1631 - 800 + 1631 * 2 + 16635 + 16635) / 100, (1500 - 736 + 3000 + 15300 + 15300) / 100, (131 - 64 + 262 + 1335 + 1335) / 100, 8]);
eq("counts", [t.payments, t.newMonthly, t.newYearly, t.renewals, t.gifts, t.refunds], [5, 1, 1, 2, 1, 1]);
eq("lines in order", t.lines.map((l) => `${l.key}:${l.count}`), ["new_month:1", "new_year:1", "renewal:2", "gift:1", "refund:1"]);
eq("the lines add up to the total", Math.round(t.lines.reduce((s, l) => s + l.collected, 0) * 100), Math.round(t.collected * 100));
eq("the Reports detail line", membershipsDetail(t), "1 new monthly · 1 new yearly · 2 renewals · 1 gift · 1 refund");
eq("line keys", [lineKey({ kind: "plus_new", billing_interval: "year" }), lineKey({ kind: "plus_new", billing_interval: null }), lineKey({ kind: "plus_switch", billing_interval: "year" })], ["new_year", "new_month", "switch"]);
eq("labels", [paymentLabel(yearly), paymentLabel(renewal), paymentLabel(re), paymentLabel(g)], ["New · Adult yearly", "Renewal · Adult monthly", "Refund · Adult monthly", "Gift · a year of Insiders+"]);
eq("nothing: all zero", [summarizeMemberships([]).collected, summarizeMemberships([]).lines.length, membershipsDetail(summarizeMemberships([]))], [0, 0, ""]);

// Where a run reads from.
const now = Date.parse("2026-09-30T15:00:00Z");
eq("first read ever: from launch", syncFrom("quick", null, now), rows.LAUNCH);
eq("quick: 3 days before the last read", syncFrom("quick", "2026-09-30T14:00:00.000Z", now), "2026-09-27T14:00:00.000Z");
eq("daily: 45 days, not before launch", syncFrom("daily", "2026-09-30T14:00:00.000Z", now), rows.LAUNCH);
eq("backfill from a day", syncFrom("backfill", "2026-09-30T14:00:00.000Z", now, "2026-09-20T09:00:00.000Z"), "2026-09-20T09:00:00.000Z");
eq(
  "a read in progress (and one that died)",
  [
    syncRunning({ started_at: new Date(now - 5000).toISOString(), finished_at: new Date(now - 600_000).toISOString() }, now),
    syncRunning({ started_at: new Date(now - (LOCK_SECONDS + 5) * 1000).toISOString(), finished_at: null }, now),
    syncRunning({ started_at: new Date(now - 600_000).toISOString(), finished_at: new Date(now - 5000).toISOString() }, now),
  ],
  [true, false, false],
);

// ---------- 6. the sync, end to end ----------
const tick = () => new Promise((res) => setImmediate(res));
function memoryStore(gifts = []) {
  const saved = new Map(); // source_id -> row (the table's unique key)
  const ends = new Map();
  let n = 0;
  const copy = (x) => ({ ...x });
  return {
    saved,
    ends,
    async existing(ids) {
      await tick();
      return ids.map((i) => saved.get(i)).filter(Boolean).map(copy);
    },
    async byPaymentIntent(ids) {
      await tick();
      return [...saved.values()].filter((x) => x.kind !== "refund" && ids.includes(x.stripe_payment_intent_id)).map(copy);
    },
    async hasEarlierPlus(sub, before) {
      await tick();
      return [...saved.values()].some((x) => x.stripe_subscription_id === sub && x.product === "plus" && x.kind !== "refund" && x.paid_at < before);
    },
    async members(customers) {
      return customers.includes("cus_1") ? [{ id: "member_1", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" }] : [];
    },
    async paidGifts(since) {
      return gifts.filter((x) => x.paid_at >= since);
    },
    async insert(list) {
      await tick();
      let added = 0;
      for (const x of list) {
        if (saved.has(x.source_id)) continue; // on conflict do nothing
        saved.set(x.source_id, { ...x, id: `row_${++n}` });
        added++;
      }
      return added;
    },
    async update(id, patch) {
      await tick();
      for (const [k, x] of saved) if (x.id === id) saved.set(k, { ...x, ...patch });
    },
    async removeRefunds(ids) {
      let gone = 0;
      for (const i of ids) if (saved.get(i)?.kind === "refund" && saved.delete(i)) gone++;
      return gone;
    },
    async refundsOf(ids) {
      return [...saved.values()].filter((x) => ids.includes(x.refund_of)).map((x) => ({ refund_of: x.refund_of, source_id: x.source_id, amount_cents: x.amount_cents, tax_cents: x.tax_cents }));
    },
    async saveEnds(list) {
      for (const x of list) ends.set(x.stripe_subscription_id, x);
      return list.length;
    },
  };
}
const iterate = (arr) => ({
  async *[Symbol.asyncIterator]() {
    for (const x of arr) {
      await tick();
      yield x;
    }
  },
});
function fakeStripe(world) {
  return {
    invoices: {
      list: (p) =>
        iterate(world.invoices.filter((i) => (!p.created || i.created >= p.created.gte) && (!p.status || i.status === p.status) && (!p.subscription || i.parent.subscription_details.subscription === p.subscription))),
    },
    refunds: { list: (p) => iterate(world.refunds.filter((x) => x.created >= p.created.gte)) },
    events: { list: (p) => iterate(world.events.filter((x) => x.type === p.type && x.created >= p.created.gte)) },
    creditNotes: { list: (p) => iterate((world.creditNotes ?? []).filter((x) => x.invoice === p.invoice)) },
  };
}
const since = "2026-09-14T05:00:00.000Z";
const totalsOf = (store) => summarizeMemberships([...store.saved.values()]);

// A card saved on 9/29 for a first charge on 10/5, then renewals.
const s2Start = cdt("2026-10-05", "13:00");
const world = {
  invoices: [
    create,
    trialZero,
    switchInv,
    invoice({ id: "in_first", sub: "sub_2", customer: "cus_2", reason: "subscription_cycle", paidAt: s2Start, amount: 1304, tax: 104, lines: [line("price_m_senior", 1200, s2Start, cdt("2026-11-05", "13:00"))] }),
    invoice({ id: "in_renew", sub: "sub_2", customer: "cus_2", reason: "subscription_cycle", paidAt: cdt("2026-11-05", "14:00"), amount: 1304, tax: 104, lines: [line("price_m_senior", 1200, cdt("2026-11-05", "13:00"), cdt("2026-12-05", "13:00"))] }),
    invoice({ id: "in_test", sub: "sub_9", reason: "subscription_create", paidAt: monthStart, amount: 1500, livemode: false, lines: [line("price_m_adult", 1500, monthStart, monthEnd)] }),
  ],
  refunds: [
    { id: "re_ticket", amount: 500, created: unix(cdt("2026-10-02", "12:00")), status: "succeeded", payment_intent: "pi_some_ticket" },
    { id: "re_1", amount: 800, created: unix(refundAt), status: "succeeded", payment_intent: "pi_in_new" },
  ],
  events: [{ type: "customer.subscription.deleted", created: unix(cdt("2026-10-20", "09:00")), data: { object: { id: "sub_1", customer: "cus_1", livemode: true, ended_at: unix(cdt("2026-10-20", "09:00")), cancellation_details: { reason: "cancellation_requested" }, items: { data: [{ price: { id: "price_y_adult", product: PROD } }] } } } }],
};
// The trial's $0 invoice belongs to sub_2 (its sign-up).
world.invoices[1] = { ...trialZero, customer: "cus_2", parent: { type: "subscription_details", subscription_details: { subscription: "sub_2" } } };

const store = memoryStore([gift]);
const e = { stripe: fakeStripe(world), store, ctx, allowTest: false };
const c1 = await runPaymentSync(e, since);
const kinds = Object.fromEntries([...store.saved.values()].map((x) => [x.source_id, x.kind]));
eq("first read: every charge, the gift and the refund", Object.keys(kinds).sort(), ["gift:g1", "in_first", "in_new", "in_renew", "in_switch", "re_1"]);
eq(
  "kinds: sign-up new, switch, first charge after a free start new, then a renewal",
  [kinds.in_new, kinds.in_switch, kinds.in_first, kinds.in_renew, kinds["gift:g1"], kinds.re_1],
  ["plus_new", "plus_switch", "plus_new", "plus_renewal", "gift", "refund"],
);
eq("skipped: the $0 invoice, the test-mode one; a ticket refund isn't ours", [c1.skipped.nothingCharged, c1.skipped.testMode, store.saved.has("re_ticket")], [1, 1, false]);
eq("linked to the member by Stripe customer", store.saved.get("in_new").member_id, "member_1");
const refundSaved = store.saved.get("re_1");
eq("the refund: on its payment's day, pointing at it", [refundSaved.business_date, refundSaved.refund_of === store.saved.get("in_new").id, refundSaved.amount_cents], ["2026-09-28", true, -800]);
eq("the refunded payment is marked partly refunded", store.saved.get("in_new").status, "partly_refunded");
eq("an ended subscription is recorded", [store.ends.size, store.ends.get("sub_1")?.business_date, store.ends.get("sub_1")?.billing_interval], [1, "2026-10-20", "year"]);
const before = totalsOf(store);
eq("totals after the first read", [before.collected, before.tax, before.payments, before.refunds], [(1631 - 800 + 15004 + 1304 + 1304 + 16635) / 100, (131 - 64 + 1204 + 104 + 104 + 1335) / 100, 5, 1]);

const c2 = await runPaymentSync(e, since);
eq("a second read adds nothing and changes nothing", [c2.plus.added, c2.gifts.added, c2.refunds.added, c2.plus.updated, store.saved.size], [0, 0, 0, 0, 6]);
eq("...and the totals are the same", totalsOf(store).collected, before.collected);

const twin = memoryStore([gift]);
const et = { stripe: fakeStripe(world), store: twin, ctx, allowTest: false };
await Promise.all([runPaymentSync(et, since), runPaymentSync(et, since), runPaymentSync(et, since)]);
eq("three reads at once: each payment once", [twin.saved.size, totalsOf(twin).collected], [6, before.collected]);

// A saved row keeps its kind: read the renewal alone in a store that
// doesn't have the first charge (as if the window missed it) -- it's
// looked up in Stripe, still a renewal. Then its kind is never changed.
const lone = memoryStore();
await runPaymentSync({ stripe: fakeStripe({ ...world, refunds: [], events: [] }), store: lone, ctx, allowTest: false }, cdt("2026-11-01", "04:00").toISOString());
eq("a renewal read on its own is still a renewal (earlier charge found in Stripe)", lone.saved.get("in_renew")?.kind, "plus_renewal");
lone.saved.set("in_renew", { ...lone.saved.get("in_renew"), kind: "plus_new" });
await runPaymentSync({ stripe: fakeStripe({ ...world, refunds: [], events: [] }), store: lone, ctx, allowTest: false }, cdt("2026-11-01", "04:00").toISOString());
eq("a saved row's kind is kept on later reads", lone.saved.get("in_renew")?.kind, "plus_new");

// The refund fails afterwards: it goes, and the payment is paid in full again.
const failedWorld = { ...world, refunds: [{ ...world.refunds[1], status: "failed" }] };
await runPaymentSync({ stripe: fakeStripe(failedWorld), store, ctx, allowTest: false }, since);
eq("a failed refund is taken back out", [store.saved.has("re_1"), store.saved.get("in_new").status], [false, "paid"]);

// A full refund with a credit note: the note's tax is used.
const noteWorld = {
  ...world,
  refunds: [{ id: "re_full", amount: 1631, created: unix(refundAt), status: "succeeded", payment_intent: "pi_in_new" }],
  creditNotes: [{ id: "cn_1", invoice: "in_new", total: 1631, total_taxes: [{ amount: 131 }], refunds: [{ refund: "re_full" }] }],
};
await runPaymentSync({ stripe: fakeStripe(noteWorld), store, ctx, allowTest: false }, since);
const full = store.saved.get("re_full");
eq("a credit-noted refund: its tax, and the payment refunded", [full?.tax_cents, full?.stripe_credit_note_id, store.saved.get("in_new").status], [-131, "cn_1", "refunded"]);
eq("a fully refunded payment nets to zero", summarizeMemberships([store.saved.get("in_new"), full]).collected, 0);

// Test mode allowed (a test database): the test invoice counts.
const testStore = memoryStore();
await runPaymentSync({ stripe: fakeStripe(world), store: testStore, ctx, allowTest: true }, since);
eq("with test payments allowed, the test one is saved", testStore.saved.has("in_test"), true);

// ---------- 7. round 2 ----------

// Partial refunds across two reads: the second read's window starts after
// the first refund, which is saved; the later two are worked out on top of
// it, so the three give back exactly the charge's tax.
{
  const st = memoryStore();
  const r1 = { id: "re_p1", amount: 543, created: unix(cdt("2026-10-01", "12:00")), status: "succeeded", payment_intent: "pi_in_new" };
  const r2 = { id: "re_p2", amount: 544, created: unix(cdt("2026-10-02", "12:00")), status: "succeeded", payment_intent: "pi_in_new" };
  const r3 = { id: "re_p3", amount: 544, created: unix(cdt("2026-10-03", "12:00")), status: "succeeded", payment_intent: "pi_in_new" };
  const w = { invoices: [create], refunds: [r1], events: [] };
  await runPaymentSync({ stripe: fakeStripe(w), store: st, ctx, allowTest: false }, since);
  w.refunds = [r1, r2, r3];
  await runPaymentSync({ stripe: fakeStripe(w), store: st, ctx, allowTest: false }, cdt("2026-10-01", "13:00").toISOString());
  const taxes = ["re_p1", "re_p2", "re_p3"].map((id) => st.saved.get(id)?.tax_cents);
  eq("three partial refunds over two reads: tax back is exactly the charge's", [taxes, taxes.reduce((s, x) => s + x, 0), st.saved.get("in_new").status], [[-44, -43, -44], -131, "refunded"]);
  eq("...and the payment nets to zero", summarizeMemberships([...st.saved.values()]).collected, 0);
  // Read again from launch: the same three, same tax (nothing moves).
  const c = await runPaymentSync({ stripe: fakeStripe(w), store: st, ctx, allowTest: false }, since);
  eq("...and reading them all again changes nothing", [c.refunds.added, c.refunds.updated, ["re_p1", "re_p2", "re_p3"].map((id) => st.saved.get(id)?.tax_cents)], [0, 0, [-44, -43, -44]]);
}

// A senior yearly price made after the prices were read (not in ctx): looked
// up, so the first charge on it is "New yearly · Senior", not "New monthly".
{
  const st = memoryStore();
  const fresh = { productId: PROD, prices: new Map(ctx.prices), monthlyIds };
  const s = fakeStripe({ invoices: [invoice({ id: "in_sy", sub: "sub_sy", customer: "cus_sy", paidAt: cdt("2026-10-04", "15:00"), amount: 13308, tax: 1068, lines: [line("price_y_senior_new", 12240, cdt("2026-10-04", "15:00"), cdt("2027-10-04", "15:00"))] })], refunds: [], events: [] });
  s.prices = { retrieve: async (id) => ({ id, product: PROD, lookup_key: "insiders_plus_senior_yearly", unit_amount: 12240, recurring: { interval: "year" } }) };
  await runPaymentSync({ stripe: s, store: st, ctx: fresh, allowTest: false }, since);
  const row = st.saved.get("in_sy");
  eq("a price newer than the cached list is looked up", [row?.kind, row?.tier, row?.billing_interval, lineKey(row), fresh.prices.get("price_y_senior_new")?.tier], ["plus_new", "senior", "year", "new_year", "senior"]);
}

// A renewal made 10/28 whose card was declined, paid 11/3: a quick read on
// 11/3 goes back 3 days by when invoices were made (to 10/31), so it isn't
// listed; its invoice.paid event finds it.
{
  const madeAt = cdt("2026-10-28", "19:05");
  const paidLate = cdt("2026-11-03", "10:00");
  const late = invoice({ id: "in_late", reason: "subscription_cycle", paidAt: paidLate, created: unix(madeAt), amount: 1631, tax: 131, lines: [line("price_m_adult", 1500, monthEnd, cdt("2026-11-28", "18:05"))] });
  const w = { invoices: [create, late], refunds: [], events: [{ type: "invoice.paid", created: unix(paidLate), data: { object: { id: "in_late", created: unix(madeAt) } } }] };
  const s = fakeStripe(w);
  s.invoices.retrieve = async (id) => w.invoices.find((i) => i.id === id);
  const quickFrom = cdt("2026-10-31", "10:00").toISOString();
  const without = memoryStore();
  await runPaymentSync({ stripe: s, store: without, ctx, allowTest: false }, quickFrom);
  const withEvents = memoryStore();
  const c = await runPaymentSync({ stripe: s, store: withEvents, ctx, allowTest: false }, quickFrom, { latePaid: true });
  eq("an invoice paid days after it was made: missed by the created window alone", without.saved.has("in_late"), false);
  eq("...found by its invoice.paid event, a renewal on the day it was paid", [c.latePaid, withEvents.saved.get("in_late")?.kind, withEvents.saved.get("in_late")?.business_date], [1, "plus_renewal", "2026-11-03"]);
}

// Stripe can't be read: the gifts (already in the database) are saved anyway.
const failing = () => ({
  async *[Symbol.asyncIterator]() {
    await tick();
    throw new Error("Stripe is down");
  },
});
{
  const st = memoryStore([gift]);
  const s = { ...fakeStripe(world), invoices: { list: failing } };
  let threw = null;
  await runPaymentSync({ stripe: s, store: st, ctx, allowTest: false }, since).catch((err) => (threw = err.message));
  eq("Stripe down: the read fails, but the gift is saved", [threw, st.saved.has("gift:g1")], ["Stripe is down", true]);
}

// Out of time: no Stripe call starts after the deadline.
{
  const w = { invoices: [], refunds: [], events: [{ type: "invoice.paid", created: unix(cdt("2026-11-03", "10:00")), data: { object: { id: "in_old", created: unix(cdt("2026-10-01", "10:00")) } } }] };
  const s = fakeStripe(w);
  let retrieved = false;
  s.invoices.retrieve = async () => ((retrieved = true), null);
  let threw = null;
  await runPaymentSync({ stripe: s, store: memoryStore(), ctx, allowTest: false, deadline: Date.now() - 1 }, cdt("2026-10-31", "10:00").toISOString(), { latePaid: true }).catch((err) => (threw = err.message));
  eq("a run past its deadline stops before its next Stripe call", [!!threw && threw.startsWith("out of time"), retrieved], [true, false]);
  eq("a run's time is well inside its claim", RUN_SECONDS < LOCK_SECONDS, true);
}

// The claim: a fake member_payment_sync row and claim_member_payment_sync.
function fakeDb(state) {
  const log = [];
  let n = 0;
  const from = () => {
    const filters = [];
    let patch = null;
    const b = {
      select: () => b,
      update: (p) => ((patch = p), b),
      eq: (col, val) => (filters.push([col, val]), b),
      maybeSingle: async () => ({ data: { ...state }, error: null }),
      then(ok, bad) {
        let data = [];
        if (patch) {
          const match = filters.every(([c, v]) => c === "id" || state[c] === v);
          if (match) {
            Object.assign(state, patch);
            data = [{ id: true }];
          }
          log.push({ update: Object.keys(patch), match });
        }
        return Promise.resolve({ data, error: null }).then(ok, bad);
      },
    };
    return b;
  };
  return {
    state,
    log,
    from,
    async rpc(name, args) {
      log.push({ rpc: name, args });
      if (state.busy) return { data: null, error: null };
      state.run_id = `run_${++n}`;
      state.started_at = new Date().toISOString();
      return { data: state.run_id, error: null };
    },
  };
}
const quietly = async (fn) => {
  const [w, er] = [console.warn, console.error];
  console.warn = console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.warn = w;
    console.error = er;
  }
};
{
  // A normal run: claimed, then its marks written.
  const db = fakeDb({ run_id: null, started_at: null, finished_at: null, invoices_through: null });
  const r = await lockedSync(db, async () => ({ stripe: fakeStripe(world), store: memoryStore([gift]), ctx, allowTest: false }), { mode: "quick" });
  eq("a run claims, reads, and marks when", [r.ok, !!db.state.succeeded_at, !!db.state.invoices_through, db.log.filter((x) => x.update).map((x) => x.match)], [true, true, true, [true]]);

  // Taken over mid-run (it was thought to have died): its marks aren't written.
  const db2 = fakeDb({ run_id: null, started_at: null, finished_at: null, invoices_through: null });
  const st = memoryStore([gift]);
  st.paidGifts = async (sinceIso) => {
    db2.state.run_id = "run_newer";
    db2.state.started_at = "newer";
    return [gift].filter((x) => x.paid_at >= sinceIso);
  };
  const r2 = await quietly(() => lockedSync(db2, async () => ({ stripe: fakeStripe(world), store: st, ctx, allowTest: false }), { mode: "quick" }));
  eq("a run taken over saves its payments but leaves the newer run's claim and marks", [r2.ok, db2.state.run_id, db2.state.started_at, db2.state.succeeded_at ?? null], [true, "run_newer", "newer", null]);

  // Taken over, then fails: the newer run's claim isn't released.
  const db3 = fakeDb({ run_id: null, started_at: null, finished_at: null, invoices_through: null });
  const st3 = memoryStore();
  st3.paidGifts = async () => {
    db3.state.run_id = "run_newer";
    db3.state.started_at = "newer";
    return [];
  };
  const r3 = await quietly(() => lockedSync(db3, async () => ({ stripe: { ...fakeStripe(world), invoices: { list: failing } }, store: st3, ctx, allowTest: false }), { mode: "quick" }));
  eq("a failed run that was taken over doesn't release the newer claim", [r3.ok, db3.state.started_at, db3.state.last_error ?? null], [false, "newer", null]);

  // Fails while it still holds the claim: released, and the error kept.
  const db4 = fakeDb({ run_id: null, started_at: null, finished_at: null, invoices_through: null });
  const r4 = await quietly(() => lockedSync(db4, async () => ({ stripe: { ...fakeStripe(world), invoices: { list: failing } }, store: memoryStore(), ctx, allowTest: false }), { mode: "quick" }));
  eq("a failed run releases its own claim", [r4.ok, db4.state.started_at, db4.state.last_error], [false, null, "Stripe is down"]);

  // A test-key run (shared: false): no claim, no marks.
  const db5 = fakeDb({ run_id: null, started_at: null, finished_at: null, invoices_through: null });
  const st5 = memoryStore();
  const r5 = await lockedSync(db5, async () => ({ stripe: fakeStripe(world), store: st5, ctx, allowTest: true }), { mode: "backfill", force: true, shared: false });
  eq("a test-key run saves but never claims or marks the shared row", [r5.ok, st5.saved.has("in_test"), db5.log.length, db5.state.invoices_through], [true, true, 0, null]);

  // The daily run behind a read already going, with too little time left to wait.
  const db6 = fakeDb({ busy: true, run_id: "run_x", started_at: new Date().toISOString(), finished_at: null, invoices_through: null });
  const t0 = Date.now();
  const r6 = await lockedSync(db6, async () => ({ stripe: fakeStripe(world), store: memoryStore(), ctx, allowTest: false }), { mode: "daily", force: true, deadline: Date.now() + 1000 });
  eq("the daily run doesn't wait past its deadline behind another read", [r6.ok, !!r6.skipped, Date.now() - t0 < 1000], [true, true, true]);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
