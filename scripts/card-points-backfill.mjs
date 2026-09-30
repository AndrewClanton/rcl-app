// Card-linked points, looking back: which past register card sales with
// nobody attached WOULD have earned a member's points if card matching had
// been on (lib/card-match.ts, migration 20261001100000). A dry run: it only
// reads, from the database inside a read-only transaction that is rolled
// back, and from Stripe with retrieve calls. Nothing is written anywhere,
// and nothing is paid. It prints counts and order numbers only: no names,
// no member ids, no card details.
//
// What counts as a member's card here (the same rules the register uses,
// lib/card-match.ts decideCardOutcome):
//  - cards already linked (member_cards), once the migration is applied;
//  - the card on register card sales that had a member attached, once it
//    has paid for that member on LINK_AFTER_DAYS different business days
//    (4 AM to 4 AM Central), oldest sale first, unless: the member is the
//    cashier's own account (the same login or email), the card is already
//    another member's, the member already has 4 cards, the member removed
//    that card (or staff did), the member was removed, or they turned
//    linking off.
// Insiders+ subscription cards aren't counted: they're linked only from a
// checkout the member started signed in (or staff started for them), which
// past checkouts didn't record.
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

// The card a sale was paid with: the one saved with it (card_payments), or
// one Stripe read. Only a register payment for the sale's card amount, like
// the register (isRegisterPayment in lib/card-match.ts).
async function paymentCard(sale) {
  if (sale.fingerprint) return { card: { fp: sale.fingerprint, livemode: sale.livemode, wallet: sale.wallet } };
  await pause();
  try {
    const pi = await stripe.paymentIntents.retrieve(sale.stripe_payment_intent_id, { expand: ["latest_charge"] });
    const ch = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (pi.status !== "succeeded" || !ch) return { why: "not paid" };
    if (ch.refunded) return { why: "refunded in Stripe" };
    if (!["pos", "pos-tab"].includes(pi.metadata?.source ?? "") || pi.amount_received !== Math.round(Number(sale.payment_card_amount) * 100)) return { why: "not this sale's register payment" };
    const card = cardOf(ch.payment_method_details, ch.livemode);
    return card ? { card } : { why: "no card fingerprint" };
  } catch (e) {
    if (e?.code === "resource_missing") return { why: "payment not found" };
    return { why: "Stripe error" };
  }
}

// The business day (4 AM to 4 AM Central) a sale was on, as YYYY-MM-DD.
const dayOf = (at) => new Date(new Date(at).getTime() - 4 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

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

// The same numbers as in lib/card-match.ts.
const MAX_AUTO_LINKED_CARDS = 4;
const LINK_AFTER_DAYS = 2;

// owners: "fingerprint|mode" -> member ids. cardsOf: member id -> how many
// cards they have. removed: "member|fingerprint|mode" links that were
// removed, which never come back on their own. days: "member|fingerprint|
// mode" -> the business days that card paid for their attached sales.
const owners = new Map();
const cardsOf = new Map();
const removed = new Set();
const days = new Map();
const cardKey = (card) => `${card.fp}|${card.livemode}`;
const ownersOf = (card) => owners.get(cardKey(card)) ?? new Set();
const own = (card, memberId) => {
  const set = ownersOf(card);
  if (set.has(memberId)) return;
  set.add(memberId);
  owners.set(cardKey(card), set);
  cardsOf.set(memberId, (cardsOf.get(memberId) ?? 0) + 1);
};
// Would this card link to this member on its own now? (Not if they removed
// it, if someone else has it already, if they have enough cards, or before
// it has paid for them on 2 different days.)
const wouldLink = (card, memberId) => {
  const k = `${memberId}|${cardKey(card)}`;
  if (removed.has(k)) return false;
  const set = ownersOf(card);
  if (set.has(memberId)) return true;
  return set.size === 0 && (cardsOf.get(memberId) ?? 0) < MAX_AUTO_LINKED_CARDS && (days.get(k)?.size ?? 0) >= LINK_AFTER_DAYS;
};

try {
  await db.query("begin read only");
  const startAt = `${since} 04:00 America/Chicago`; // the business day starts at 4 AM

  const hasCards = (await rows("select to_regclass('public.member_cards') is not null and to_regclass('public.card_payments') is not null as ok"))[0].ok;
  const hasSwitch = (await rows("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'link_cards') as ok"))[0].ok;
  const switchedOff = hasSwitch ? "and m.link_cards" : "";
  // The card saved with each sale, once the migration is applied.
  const saved = hasCards
    ? "left join card_payments cp on cp.order_id = o.id"
    : "left join (select null::uuid as order_id, null::text as fingerprint, null::boolean as livemode, null::text as wallet) cp on false";

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

  // 2. Cards on card sales that had a member attached by staff, oldest
  // first. The cashier's own account: the same login, or the same email.
  const sourceCol = hasCards ? "o.member_source" : "null::text";
  const attached = await rows(
    `select o.member_id, o.stripe_payment_intent_id, o.payment_card_amount, o.completed_at,
            cp.fingerprint, cp.livemode, cp.wallet,
            ((m.auth_user_id is not null and m.auth_user_id = e.auth_user_id)
              or (m.email is not null and u.email is not null and lower(btrim(m.email)) = lower(btrim(u.email)))) as own_account
     from orders o
     join members m on m.id = o.member_id
     left join employees e on e.id = o.employee_id
     left join auth.users u on u.id = e.auth_user_id
     ${saved}
     where o.status = 'completed' and o.stripe_payment_intent_id is not null and ${sourceCol} is null
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
    const got = await paymentCard(r);
    if (!got.card) continue;
    const k = `${r.member_id}|${cardKey(got.card)}`;
    if (!days.has(k)) days.set(k, new Set());
    days.get(k).add(dayOf(r.completed_at));
    if (!ownersOf(got.card).has(r.member_id) && wouldLink(got.card, r.member_id)) {
      own(got.card, r.member_id);
      learned++;
    }
  }
  console.log(
    `Card sales with a member attached: ${attached.length} (would link ${learned} card${learned === 1 ? "" : "s"}; ${ownAccount} on the cashier's own account, skipped)\n`,
  );

  // The sales with nobody on them, whose points nobody has had yet.
  const sales = await rows(
    `select o.order_number, o.subtotal, o.stripe_payment_intent_id, o.payment_card_amount, cp.fingerprint, cp.livemode, cp.wallet
     from orders o
     ${saved}
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
    const got = await paymentCard(s);
    if (!got.card) {
      put(got.why, s.order_number);
      continue;
    }
    const who = ownersOf(got.card);
    if (who.size === 0) put(got.card.wallet && got.card.wallet !== "link" ? "no match (phone or watch wallet)" : "no match", s.order_number);
    else if (who.size > 1) put("shared card: would ask who at the register", s.order_number);
    else {
      put("WOULD MATCH one member", s.order_number);
      points += Number(s.subtotal);
      gainers.add([...who][0]);
    }
  }

  console.log(`Card sales with nobody attached: ${sales.length}`);
  const order = [
    "WOULD MATCH one member",
    "shared card: would ask who at the register",
    "no match",
    "no match (phone or watch wallet)",
    "no card fingerprint",
    "refunded in Stripe",
    "not paid",
    "not this sale's register payment",
    "payment not found",
    "Stripe error",
  ];
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
