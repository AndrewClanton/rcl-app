// Health check for the points system. Safe to run anytime:
//  1. Every member's balance equals the sum of their points history.
//  2. The database functions behave (earn, redeem, duplicate protection,
//     refund reversal) -- exercised on a throwaway member inside a
//     transaction that is always rolled back, so nothing is saved.
//
// Usage: node scripts/check-points-ledger.mjs
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

try {
  const drift = await c.query(`
    select m.id, m.points, coalesce(sum(l.delta), 0) as ledger
    from members m left join points_ledger l on l.member_id = m.id
    group by m.id, m.points
    having m.points <> coalesce(sum(l.delta), 0)`);
  check("every balance matches its history", drift.rowCount === 0, drift.rowCount ? `${drift.rowCount} member(s) out of step` : "");

  await c.query("begin");
  const m = (await c.query("insert into members (name, email, tier, points) values ('Points Check', 'points-check@example.invalid', 'Insiders', 0) returning id")).rows[0].id;
  const o = (await c.query("insert into orders (order_number, source, status, member_id, subtotal, total, completed_at) values (999999001, 'pos', 'completed', $1, 42.5, 45.9, now()) returning id", [m])).rows[0].id;
  await c.query("select apply_member_points($1, 150, 'adjustment')", [m]);
  await c.query("select apply_member_points($1, -100, 'redeem', $2)", [m, o]);
  const bal = (await c.query("select apply_member_points($1, 42.5, 'purchase', $2) as b", [m, o])).rows[0].b;
  check("earn + redeem", Number(bal) === 92.5, `balance ${bal}`);

  let dup = null;
  try {
    await c.query("savepoint s");
    await c.query("select apply_member_points($1, 42.5, 'purchase', $2)", [m, o]);
  } catch (e) {
    dup = e.code;
    await c.query("rollback to savepoint s");
  }
  check("a purchase can't earn twice", dup === "23505");

  const rev = (await c.query("select reverse_purchase_points($1, null) as b", [o])).rows[0].b;
  check("refund takes back earned points and returns redeemed ones", Number(rev) === 150, `balance ${rev}`);
  const again = (await c.query("select reverse_purchase_points($1, null) as b", [o])).rows[0].b;
  check("refund reverses only once", again === null);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll points checks passed. Nothing was saved.");
process.exit(failures ? 1 : 0);
