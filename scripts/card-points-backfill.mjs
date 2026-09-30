// Card-linked points, looking back: which past register card sales with
// nobody attached WOULD have gone to a member if card matching had been on
// (lib/card-match.ts, migration 20261001100000). A dry run: it only reads,
// from the database inside a read-only transaction that is rolled back, and
// from Stripe with retrieve calls. Nothing is written anywhere, and nothing
// is paid. It prints counts and order numbers only: no names, no member
// ids, no card details.
//
// What counts as a member's card here (the same rules the register uses,
// lib/card-match.ts decideCardOutcome):
//  - cards already linked (member_cards), once the migration is applied;
//  - each Insiders+ member's subscription card;
//  - the card on a register card sale that had a member attached, oldest
//    sale first, unless: the member was the cashier's own account, the
//    card is already another member's (the register asks before sharing
//    one), the member already has 4 cards, the member removed that card
//    (or staff did), the member was removed, or they turned linking off.
// A card that belongs to exactly one member would match. Two or more would
// ask at the register, so they're listed apart and never counted as points.
// A sale whose points were already paid once (say a card match that was
// undone) is never paid again, so it's left out.
//
// The payments are real (live mode), so a test Stripe key finds none of
// them: every sale lands under "payment not found". Getting real numbers
// needs the live key, which only reads here but still takes --live to use.
//
// Usage: node scripts/card-points-backfill.mjs [--since 2026-09-14] [--live]
import pg from "pg";
import Stripe from "stripe";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const since = opt("--since", "2026-09-14"); // the register's first day
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.log("--since takes a date like 2026-09-14.");
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY || "";
const mode = /^(sk|rk)_live_/.test(key) ? "live" : /^(sk|rk)_test_/.test(key) ? "test" : null;
if (!mode) {
  console.log("No Stripe key in .env.local (STRIPE_SECRET_KEY). Stopping.");
  process.exit(1);
}
if (mode === "live" && !args.includes("--live")) {
  console.log("This is the LIVE Stripe key. The script only reads, but add --live to confirm you mean to use it.");
  process.exit(1);
}
console.log(`Stripe key: ${mode} mode. ${mode === "test" ? "Real (live) payments won't be found with it." : "Reading only."}`);
console.log(`Sales since ${since}, Central time.\n`);

const stripe = new Stripe(key, { maxNetworkRetries: 1, timeout: 20_000 });
// About 5 Stripe reads a second, well under Stripe's limits.
const pause = () => new Promise((r) => setTimeout(r, 200));

function cardOf(details, livemode) {
  // Same order as cardFromCharge in lib/card-match.ts.
  const c = details?.card_present ?? details?.interac_present ?? details?.card ?? null;
  const fp = c?.fingerprint;
  return typeof fp === "string" && fp && typeof livemode === "boolean" ? { fp, livemode, wallet: c.wallet?.type ?? null } : null;
}

async function paymentCard(paymentIntentId) {
  await pause();
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (pi.status !== "succeeded" || !ch) return { why: "not paid" };
    if (ch.refunded) return { why: "refunded in Stripe" };
    const card = cardOf(ch.payment_method_details, ch.livemode);
    return card ? { card } : { why: "no card fingerprint" };
  } catch (e) {
    if (e?.code === "resource_missing") return { why: "payment not found" };
    return { why: "Stripe error" };
  }
}

async function subscriptionCard(subscriptionId, customerId) {
  await pause();
  try {
    let pm = null;
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
      pm = sub.default_payment_method && typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
    }
    if (!pm && customerId) {
      await pause();
      const cus = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
      const d = cus.deleted ? null : cus.invoice_settings?.default_payment_method;
      pm = d && typeof d === "object" ? d : null;
    }
    if (!pm && customerId) {
      await pause();
      const saved = await stripe.customers.listPaymentMethods(customerId, { type: "card", limit: 2 });
      pm = saved.data.length === 1 ? saved.data[0] : null;
    }
    return pm?.card ? cardOf({ card: pm.card }, pm.livemode) : null;
  } catch {
    return null;
  }
}

const db = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const rows = async (sql, params) => (await db.query(sql, params)).rows;

// The same number as MAX_AUTO_LINKED_CARDS in lib/card-match.ts.
const MAX_AUTO_LINKED_CARDS = 4;

// owners: "fingerprint|mode" -> member ids. cardsOf: member id -> how many
// cards they have. removed: "member|fingerprint|mode" links that were
// removed, which never come back on their own.
const owners = new Map();
const cardsOf = new Map();
const removed = new Set();
const cardKey = (card) => `${card.fp}|${card.livemode}`;
const ownersOf = (card) => owners.get(cardKey(card)) ?? new Set();
const own = (card, memberId) => {
  const set = ownersOf(card);
  if (set.has(memberId)) return;
  set.add(memberId);
  owners.set(cardKey(card), set);
  cardsOf.set(memberId, (cardsOf.get(memberId) ?? 0) + 1);
};
// Would this card link to this member on its own? (Not if they removed it,
// if someone else has it already, or if they have enough cards.)
const wouldLink = (card, memberId) => {
  if (removed.has(`${memberId}|${cardKey(card)}`)) return false;
  const set = ownersOf(card);
  if (set.has(memberId)) return true;
  return set.size === 0 && (cardsOf.get(memberId) ?? 0) < MAX_AUTO_LINKED_CARDS;
};

try {
  await db.query("begin read only");
  const startAt = `${since} 04:00 America/Chicago`; // the business day starts at 4 AM

  const hasCards = (await rows("select to_regclass('public.member_cards') is not null as ok"))[0].ok;
  const hasSwitch = (await rows("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'link_cards') as ok"))[0].ok;
  const switchedOff = hasSwitch ? "and m.link_cards" : "";

  // 1. Cards already linked (and the ones removed, which stay removed).
  if (hasCards) {
    const linked = await rows(
      `select c.member_id, c.fingerprint, c.livemode, c.removed_at is not null as removed from member_cards c join members m on m.id = c.member_id
       where m.erased_at is null ${switchedOff}`,
    );
    for (const r of linked) {
      if (r.removed) removed.add(`${r.member_id}|${r.fingerprint}|${r.livemode}`);
      else own({ fp: r.fingerprint, livemode: r.livemode }, r.member_id);
    }
    console.log(`Cards already linked: ${linked.filter((r) => !r.removed).length} (${linked.filter((r) => r.removed).length} removed)`);
  } else {
    console.log("Cards already linked: none yet (migration 20261001100000 isn't applied).");
  }

  // 2. Insiders+ subscription cards.
  const plus = await rows(
    `select m.id, m.stripe_subscription_id, m.stripe_customer_id from members m
     where m.stripe_subscription_id is not null and m.erased_at is null ${switchedOff}`,
  );
  let plusCards = 0;
  for (const r of plus) {
    const card = await subscriptionCard(r.stripe_subscription_id, r.stripe_customer_id);
    if (card && wouldLink(card, r.id)) {
      own(card, r.id);
      plusCards++;
    }
  }
  console.log(`Insiders+ subscriptions: ${plus.length} (cards linked for ${plusCards})`);

  // 3. Cards on card sales that had a member attached, oldest first.
  const attached = await rows(
    `select o.member_id, o.stripe_payment_intent_id,
            (m.auth_user_id is not null and m.auth_user_id = e.auth_user_id) as own_account
     from orders o
     join members m on m.id = o.member_id
     left join employees e on e.id = o.employee_id
     where o.status = 'completed' and o.stripe_payment_intent_id is not null
       and o.completed_at >= $1::timestamptz and m.erased_at is null ${switchedOff}
     order by o.completed_at`,
    [startAt],
  );
  let learned = 0;
  let ownAccount = 0;
  for (const r of attached) {
    if (r.own_account) {
      ownAccount++;
      continue;
    }
    const got = await paymentCard(r.stripe_payment_intent_id);
    if (got.card && wouldLink(got.card, r.member_id)) {
      own(got.card, r.member_id);
      learned++;
    }
  }
  console.log(`Card sales with a member attached: ${attached.length} (would link a card from ${learned}; ${ownAccount} on the cashier's own account, skipped)\n`);

  // The sales with nobody on them, whose points nobody has had yet.
  const sales = await rows(
    `select o.order_number, o.subtotal, o.stripe_payment_intent_id from orders o
     where o.status = 'completed' and o.member_id is null and o.stripe_payment_intent_id is not null
       and o.completed_at >= $1::timestamptz
       and not exists (select 1 from points_ledger l where l.order_id = o.id and l.reason = 'purchase')
     order by o.completed_at`,
    [startAt],
  );
  const buckets = new Map();
  const put = (name, orderNumber) => {
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push(Number(orderNumber));
  };
  let points = 0;
  const gainers = new Set();
  for (const s of sales) {
    const got = await paymentCard(s.stripe_payment_intent_id);
    if (!got.card) {
      put(got.why, s.order_number);
      continue;
    }
    const who = owners.get(`${got.card.fp}|${got.card.livemode}`);
    if (!who || who.size === 0) put(got.card.wallet ? "no match (phone or watch wallet)" : "no match", s.order_number);
    else if (who.size > 1) put("shared card: would ask who at the register", s.order_number);
    else {
      put("WOULD MATCH one member", s.order_number);
      points += Number(s.subtotal);
      gainers.add([...who][0]);
    }
  }

  console.log(`Card sales with nobody attached: ${sales.length}`);
  const order = ["WOULD MATCH one member", "shared card: would ask who at the register", "no match", "no match (phone or watch wallet)", "no card fingerprint", "refunded in Stripe", "not paid", "payment not found", "Stripe error"];
  for (const name of [...order, ...[...buckets.keys()].filter((k) => !order.includes(k))]) {
    const list = buckets.get(name);
    if (!list?.length) continue;
    console.log(`  ${name}: ${list.length}  (orders ${list.map((n) => `#${n}`).join(", ")})`);
  }
  console.log(`\nWould award: ${Math.round(points)} points, to ${gainers.size} member${gainers.size === 1 ? "" : "s"}.`);
  console.log("Nothing was written. Paying any of these would be a separate, reviewed step.");
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
