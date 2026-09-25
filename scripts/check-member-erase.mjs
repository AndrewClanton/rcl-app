// Health check for removing a member's personal info. Safe to run anytime:
// builds a throwaway member with an order, a ticket, a booth reservation,
// a private event, an old-site record (plus a duplicate old account with
// the same email) and points, runs erase_member_personal_info(), checks
// that every trace of them is gone, then rolls everything back.
//
// Usage: node scripts/check-member-erase.mjs
import pg from "pg";
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
const EMAIL = "erase-check@example.invalid";

try {
  await c.query("begin");
  const staff = await one("select id from employees order by created_at limit 1");
  const room = await one("select id from rooms limit 1");
  const booth = await one("select id from booths limit 1");
  const m = (await one(
    `insert into members (name, email, phone, tier, points, avatar_url, comp_notes, legacy_user_id, price_tier)
     values ('Erase Check', $1, '(417) 555-0199', 'Insiders', 0, 'https://example.invalid/p.jpg', 'note about them', 99999991, 'senior') returning id`,
    [EMAIL]
  )).id;
  const o = (await one(`insert into orders (order_number, source, status, member_id, order_name, tab_name, subtotal, total, completed_at)
     values (999999002, 'pos', 'completed', $1, 'Erase Check''s tab', 'Erase tab', 20, 21.6, now()) returning id`, [m])).id;
  const scr = await one("select id from screenings limit 1");
  let b = null;
  if (scr) b = (await one(`insert into bookings (screening_id, member_id, customer_name, customer_email, quantity, unit_price, status)
     values ($1, $2, 'Erase Check', $3, 1, 12, 'confirmed') returning id`, [scr.id, m, EMAIL])).id;
  let br = null;
  if (booth) br = (await one(`insert into booth_reservations (booth_id, member_id, customer_name, customer_email, customer_phone, party_size, reservation_date, start_time, fee_amount)
     values ($1, $2, 'Erase Check', $3, '4175550199', 2, current_date, '19:00', 10) returning id`, [booth.id, m, EMAIL])).id;
  let ev = null;
  if (room) ev = (await one(`insert into events (room_id, hours, event_date, event_time, organizer_name, organizer_email, estimate_total)
     values ($1, 2, current_date, '18:00', 'Erase Check', $2, 100) returning id`, [room.id, EMAIL.toUpperCase()])).id;
  await c.query(`insert into legacy_accounts (legacy_user_id, email, username, first_name, last_name, phone, classification, decision)
     values (99999991, $1, $1, 'Erase', 'Check', '(417) 555-0199', 'likely_real', 'import'),
            (99999992, $1, 'dup', 'Erase', 'Check', null, 'likely_real', 'import')`, [EMAIL]);
  await c.query("select apply_member_points($1, 25, 'adjustment', null, null, 'test', null)", [m]);

  const res = (await one("select erase_member_personal_info($1, $2) as r", [m, staff?.id ?? null])).r;
  console.log("  function reported:", JSON.stringify(res));

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
    const e = await one("select organizer_name, organizer_email from events where id = $1", [ev]);
    check("private event contact removed (matched by email, any case)", !e.organizer_name && e.organizer_email === "");
  }
  const leg = (await c.query("select legacy_user_id, email, first_name, phone, decision, erased_at from legacy_accounts where legacy_user_id in (99999991, 99999992) order by 1")).rows;
  check("old-site copy and its duplicate scrubbed and marked erased", leg.length === 2 && leg.every((l) => !l.email && !l.first_name && !l.phone && l.decision === "skip" && l.erased_at));
  const pts = await one("select count(*)::int as n from points_ledger where member_id = $1", [m]);
  check("points history deleted", pts.n === 0);
  const again = (await one("select erase_member_personal_info($1, null) as r", [m])).r;
  check("running it twice is harmless", again.already_erased === true);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll removal checks passed. Nothing was saved.");
process.exit(failures ? 1 : 0);
