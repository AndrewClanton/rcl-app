// Health check for the points system. Safe to run anytime:
//  1. Every member's balance equals the sum of their points history
//     (read-only; prints counts, never who). Nothing blocks a direct write
//     to members.points in the database, so this is the guard: run it after
//     any migration or script that touches points.
//  2. The database functions behave (earn, redeem, duplicate protection,
//     refund reversal, staff adjustments) -- exercised on a throwaway member
//     inside a transaction that is always rolled back, so nothing is saved.
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
  // ---------- 1. balance = history (read-only, counts only) ----------
  const drift = (
    await c.query(`
      with d as (
        select m.points - coalesce(sum(l.delta), 0) as diff
        from members m left join points_ledger l on l.member_id = m.id
        group by m.id, m.points
      )
      select count(*)::int as members,
             count(*) filter (where diff <> 0)::int as off,
             coalesce(sum(abs(diff)) filter (where diff <> 0), 0)::float as points
      from d`)
  ).rows[0];
  check(
    "every balance matches its history",
    drift.off === 0,
    drift.off ? `${drift.off} of ${drift.members} member(s) out of step, ${drift.points} point(s) in total` : `${drift.members} members`,
  );
  const negative = (await c.query("select count(*)::int as n from members where points < 0")).rows[0].n;
  console.log(`info  ${negative} member(s) with a balance below zero`);

  // ---------- 2. the functions, on a throwaway member (rolled back) ----------
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

  // Staff adjustments (the Back office's "Add or take away points").
  const staff = (await c.query("select id from employees order by created_at limit 1")).rows[0]?.id ?? null;
  const adjust = async (delta, note, expected) =>
    (await c.query("select adjust_member_points($1, $2, $3, $4, $5) as r", [m, delta, note, staff, expected])).rows[0].r;
  const rows = async () => (await c.query("select count(*)::int as n from points_ledger where member_id = $1", [m])).rows[0].n;

  const before = await rows();
  const a1 = await adjust(25, "Birthday party credit", 150);
  const last = (await c.query("select reason, delta::float, balance_after::float, note, created_by from points_ledger where member_id = $1 order by created_at desc, balance_after desc limit 1", [m])).rows[0];
  check("an adjustment writes one row", a1.status === "ok" && Number(a1.balance) === 175 && (await rows()) === before + 1, JSON.stringify(a1));
  check("the row says why and who", last.reason === "adjustment" && last.delta === 25 && last.balance_after === 175 && last.note === "Birthday party credit" && last.created_by === staff);
  const a2 = await adjust(25, "Birthday party credit", 150);
  check("pressing confirm twice adds it once", a2.status === "duplicate" && Number(a2.balance) === 175 && (await rows()) === before + 1, a2.status);
  const a3 = await adjust(-10, "Fixed a double charge", 150);
  check("a balance that moved in between is refused", a3.status === "stale" && Number(a3.balance) === 175 && (await rows()) === before + 1, a3.status);
  const a4 = await adjust(-176, "Fixed a double charge", 175);
  check("taking it below zero is refused", a4.status === "negative" && (await rows()) === before + 1, a4.status);
  const a5 = await adjust(-175, "Fixed a double charge", 175);
  check("taking it to exactly zero works", a5.status === "ok" && Number(a5.balance) === 0, JSON.stringify(a5));
  let bad = 0;
  for (const [delta, note] of [[0, "Nothing at all"], [2.5, "Half points"], [5, "   "]]) {
    try {
      await c.query("savepoint s");
      await adjust(delta, note, 0);
    } catch (e) {
      if (e.code === "22023") bad++;
      await c.query("rollback to savepoint s");
    }
  }
  check("zero, fractions and a blank reason are refused", bad === 3, `${bad}/3`);
  const own = (await c.query("select m.points::float as p, (select coalesce(sum(delta), 0) from points_ledger where member_id = m.id)::float as s from members m where id = $1", [m])).rows[0];
  check("the test member's balance matches its history", own.p === own.s, `${own.p} vs ${own.s}`);
  let merge = null;
  try {
    await c.query("savepoint s");
    await c.query("select apply_member_points($1, 10, 'merge', null, null, 'Merged from a duplicate account')", [m]);
    merge = "ok";
  } catch (e) {
    merge = e.code;
    await c.query("rollback to savepoint s");
  }
  check("'merge' is an allowed reason", merge === "ok", merge);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll points checks passed. Nothing was saved.");
process.exit(failures ? 1 : 0);
