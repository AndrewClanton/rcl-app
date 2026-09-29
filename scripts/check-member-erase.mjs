// Health check for removing a member's personal info. Safe to run anytime:
// builds a throwaway member with an order, a ticket, a booth reservation,
// a private event, an old-site record (plus a duplicate old account with
// the same email), points, a custom item, a gift they bought and one they
// got, check-in visits and rewards, runs erase_member_personal_info(),
// checks that every trace of them is gone, then rolls everything back.
//
// Usage: node scripts/check-member-erase.mjs [migration.sql]
//
// Passing a migration file runs it inside the same rolled-back transaction
// first, to check a new version of the function against the real schema
// before it's applied. Nothing is saved either way.
import pg from "pg";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];
const exists = async (sql, params) => !!(await one(sql, params))?.ok;
const EMAIL = "erase-check@example.invalid";
const REQUESTED_ON = "2026-09-01";

try {
  await c.query("begin");
  // Don't hold up the live app if something else has a lock we need.
  await c.query("set local lock_timeout = '3s'");
  const migration = process.argv[2];
  if (migration) {
    await c.query(readFileSync(migration, "utf8"));
    console.log(`  ran ${migration} inside the test transaction (rolled back at the end)`);
  }
  const hasV2 = await exists(
    "select true as ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'erase_member_personal_info' and p.pronargs = 3"
  );
  const hasTagline = await exists("select true as ok from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'tagline'");
  const hasVisits = await exists("select (to_regclass('public.member_visits') is not null) as ok");
  const hasRewards = await exists("select (to_regclass('public.member_rewards') is not null) as ok");

  const staff = await one("select id from employees order by created_at limit 1");
  const room = await one("select id from rooms limit 1");
  const booth = await one("select id from booths limit 1");
  const m = (await one(
    `insert into members (name, email, phone, tier, points, avatar_url, comp_notes, legacy_user_id, price_tier)
     values ('Erase Check', $1, '(417) 555-0199', 'Insiders', 0, 'https://example.invalid/p.jpg', 'note about them', 99999991, 'senior') returning id`,
    [EMAIL]
  )).id;
  const friend = (await one(`insert into members (name, email, tier, points) values ('Erase Friend', 'erase-friend@example.invalid', 'Insiders', 0) returning id`)).id;
  if (hasTagline) await c.query("update members set tagline = 'Horror or nothing' where id = $1", [m]);
  const o = (await one(`insert into orders (order_number, source, status, member_id, order_name, tab_name, subtotal, total, completed_at)
     values (999999002, 'pos', 'completed', $1, 'Erase Check''s tab', 'Erase tab', 20, 21.6, now()) returning id`, [m])).id;
  await c.query(`insert into order_items (order_id, menu_item_id, name, unit_price, quantity) values ($1, null, 'Cake for Erase Check', 5, 1)`, [o]);
  // A closed tab named after them with nobody attached, and an open one
  // that must be left alone (someone could still be on it).
  const oClosed = (await one(`insert into orders (order_number, source, status, tab_name, tab_card_customer_id, subtotal, total, completed_at)
     values (999999003, 'pos', 'completed', 'erase check', 'cus_erase_check', 8, 8.64, now()) returning id`)).id;
  const oOpen = (await one(`insert into orders (order_number, source, status, tab_name, subtotal, total)
     values (999999004, 'pos', 'tab', 'Erase Check', 0, 0) returning id`)).id;
  const scr = await one("select id from screenings limit 1");
  let b = null;
  if (scr) b = (await one(`insert into bookings (screening_id, member_id, customer_name, customer_email, quantity, unit_price, status)
     values ($1, $2, 'Erase Check', $3, 1, 12, 'confirmed') returning id`, [scr.id, m, EMAIL])).id;
  let br = null;
  if (booth) br = (await one(`insert into booth_reservations (booth_id, member_id, customer_name, customer_email, customer_phone, party_size, reservation_date, start_time, fee_amount)
     values ($1, $2, 'Erase Check', $3, '4175550199', 2, current_date, '19:00', 10) returning id`, [booth.id, m, EMAIL])).id;
  let ev = null;
  if (room) ev = (await one(`insert into events (room_id, event_name, hours, event_date, event_time, organizer_name, organizer_email, estimate_total)
     values ($1, 'Erase Check''s 40th', 2, current_date, '18:00', 'Erase Check', $2, 100) returning id`, [room.id, EMAIL.toUpperCase()])).id;
  await c.query(`insert into legacy_accounts (legacy_user_id, email, username, first_name, last_name, phone, classification, decision)
     values (99999991, $1, $1, 'Erase', 'Check', '(417) 555-0199', 'likely_real', 'import'),
            (99999992, $1, 'dup', 'Erase', 'Check', null, 'likely_real', 'import')`, [EMAIL]);
  await c.query("select apply_member_points($1, 25, 'adjustment', null, null, 'test', null)", [m]);
  const giftBought = (await one(`insert into gift_memberships (recipient_member_id, buyer_name, buyer_email, message, price)
     values ($1, 'Erase Check', $2, 'Happy birthday from Erase', 100) returning id`, [friend, EMAIL])).id;
  const giftGot = (await one(`insert into gift_memberships (recipient_member_id, buyer_name, buyer_email, message, price)
     values ($1, 'Erase Friend', 'erase-friend@example.invalid', 'For you, Erase', 100) returning id`, [m])).id;
  if (hasVisits) await c.query("insert into member_visits (member_id, business_date, streak, points_awarded) values ($1, current_date - 1, 1, 10), ($1, current_date, 2, 10)", [m]);
  if (hasRewards) await c.query("insert into member_rewards (member_id, kind, reason, earned_on, redeemed_at) values ($1, 'popcorn', '7-day streak', current_date - 3, now()), ($1, 'pizza', '30-day streak', current_date, null)", [m]);

  const res = hasV2
    ? (await one("select erase_member_personal_info($1, $2, $3::date) as r", [m, staff?.id ?? null, REQUESTED_ON])).r
    : (await one("select erase_member_personal_info($1, $2) as r", [m, staff?.id ?? null])).r;
  console.log(`  function (${hasV2 ? "with request date" : "original"}) reported:`, JSON.stringify(res));

  const after = await one("select * from members where id = $1", [m]);
  check("member row keeps no personal details",
    after.name === "Removed member" && !after.email && !after.phone && !after.avatar_url && !after.comp_notes && !after.auth_user_id && !after.price_tier && Number(after.points) === 0 && after.erased_at && after.email_opt_in === false);
  check("placeholder still links to the old-site id (blocks re-import)", after.legacy_user_id === 99999991);
  const ord = await one("select order_name, tab_name, member_id, total from orders where id = $1", [o]);
  check("order kept for taxes, name removed", !ord.order_name && !ord.tab_name && ord.member_id === m && Number(ord.total) === 21.6);
  if (b) {
    const bk = await one("select customer_name, customer_email from bookings where id = $1", [b]);
    check("ticket buyer name and email removed", !bk.customer_name && !bk.customer_email);
  }
  if (br) {
    const r = await one("select customer_name, customer_email, customer_phone from booth_reservations where id = $1", [br]);
    check("booth reservation contact removed", r.customer_name === "Removed member" && r.customer_email === "" && !r.customer_phone);
  }
  if (ev) {
    const e = await one("select organizer_name, organizer_email, event_name, estimate_total from events where id = $1", [ev]);
    check("private event contact removed (matched by email, any case)", !e.organizer_name && e.organizer_email === "");
    if (hasV2) check("private event's own name removed, money kept", e.event_name === "Private event" && Number(e.estimate_total) === 100);
  }
  const leg = (await c.query("select legacy_user_id, email, first_name, phone, decision, erased_at from legacy_accounts where legacy_user_id in (99999991, 99999992) order by 1")).rows;
  check("old-site copy and its duplicate scrubbed and marked erased", leg.length === 2 && leg.every((l) => !l.email && !l.first_name && !l.phone && l.decision === "skip" && l.erased_at));
  const pts = await one("select count(*)::int as n from points_ledger where member_id = $1", [m]);
  check("points history deleted", pts.n === 0);

  if (hasV2) {
    const item = await one("select name, unit_price from order_items where order_id = $1", [o]);
    check("custom item text on their order removed, price kept", item.name === "Custom item" && Number(item.unit_price) === 5);
    const closed = await one("select tab_name, tab_card_customer_id from orders where id = $1", [oClosed]);
    check("closed tab named after them (no member attached) cleared", !closed.tab_name);
    check("its tab card's Stripe customer handed back for the app to blank", Array.isArray(res.tab_card_customers) && res.tab_card_customers.includes("cus_erase_check") && closed.tab_card_customer_id === "cus_erase_check");
    const open = await one("select tab_name from orders where id = $1", [oOpen]);
    check("open tab with the same name left alone", open.tab_name === "Erase Check");
    const gb = await one("select buyer_name, buyer_email, message, recipient_member_id, price from gift_memberships where id = $1", [giftBought]);
    check("gift they bought: buyer name, email and note removed; friend keeps the gift", gb.buyer_name === "Removed member" && gb.buyer_email === "" && !gb.message && gb.recipient_member_id === friend && Number(gb.price) === 100);
    const gg = await one("select buyer_name, buyer_email, message from gift_memberships where id = $1", [giftGot]);
    check("gift they got: note removed, the buyer's own receipt details kept", !gg.message && gg.buyer_name === "Erase Friend" && gg.buyer_email === "erase-friend@example.invalid");
    const fr = await one("select name, email from members where id = $1", [friend]);
    check("the friend's own account untouched", fr.name === "Erase Friend" && fr.email === "erase-friend@example.invalid");
    if (hasTagline) {
      const t = await one("select tagline from members where id = $1", [m]);
      check("profile quote removed", !t.tagline);
    }
    if (hasVisits) {
      const v = (await c.query("select streak, points_awarded from member_visits where member_id = $1", [m])).rows;
      check("check-in visits kept as counts, without streak or points", v.length === 2 && v.every((x) => x.streak === null && x.points_awarded === null));
    }
    if (hasRewards) {
      const rw = (await c.query("select kind, redeemed_at from member_rewards where member_id = $1", [m])).rows;
      check("unused reward deleted, used one kept as a count", rw.length === 1 && rw[0].kind === "popcorn" && rw[0].redeemed_at);
    }
    const log = await one("select requested_on::text as requested_on, erased_by, cleared from member_erasures where member_id = $1", [m]);
    check("removal logged with the day they asked and who did it", !!log && log.requested_on === REQUESTED_ON && log.erased_by === (staff?.id ?? null) && typeof log.cleared?.orders === "number");
    check("log doesn't keep the Stripe tab-card ids", !!log && !("tab_card_customers" in (log.cleared ?? {})));
  } else {
    console.log("  (the request-date version isn't in this database yet: pass its migration file to check it)");
  }

  const again = (await one("select erase_member_personal_info($1, null) as r", [m])).r;
  check("running it twice is harmless", again.already_erased === true);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll removal checks passed. Nothing was saved.");
process.exit(failures ? 1 : 0);
