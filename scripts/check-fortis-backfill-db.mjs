// Health check for points from past card purchases, in the database.
// Read-only by default, safe to run anytime:
//  1. fortis_cards and fortis_backfill_grants are server-only (RLS on, no
//     policies), and grant_fortis_backfill can't be called from a browser.
//  2. The points history allows 'backfill' (and every reason it allowed before).
//  3. Removing a member's info reaches their cards (the trigger is there).
//  4. Every balance still equals its history; every granted card belongs to a
//     grant, each grant's card shares add up, and each member has one
//     'backfill' history row per grant that paid points.
//
// --exercise also runs a grant end to end on a throwaway member and card
// inside a transaction that is always rolled back (nothing is saved, nobody
// real is touched): it pays once, a second run is refused, a skipped card
// can't be granted, and removing the member's info clears the card.
//
// Usage: node scripts/check-fortis-backfill-db.mjs [--exercise]
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const EXERCISE = process.argv.includes("--exercise");
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
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];

try {
  for (const t of ["fortis_cards", "fortis_backfill_grants"]) {
    const r = await one(
      `select c.relrowsecurity as rls, (select count(*) from pg_policies p where p.tablename = c.relname and p.schemaname = 'public')::int as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`,
      [t],
    );
    check(`${t}: RLS on, no client policies`, !!r && r.rls && r.policies === 0, r ? `rls ${r.rls}, ${r.policies} policies` : "missing");
  }
  const fn = "public.grant_fortis_backfill(jsonb, jsonb, text, uuid)";
  const priv = await one(
    `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as authed, has_function_privilege('service_role', $1, 'execute') as service`,
    [fn],
  );
  check("grant can't be called by anon or signed-in users", !priv.anon && !priv.authed && priv.service, JSON.stringify(priv));

  const def = (await one(`select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.points_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%'`))?.d ?? "";
  const before = ["purchase", "redeem", "refund", "welcome_bonus", "adjustment", "opening_balance", "visit", "badge"];
  check("points history allows 'backfill'", def.includes("'backfill'"));
  check("and every reason it allowed before", before.every((r) => def.includes(`'${r}'`)));
  const trig = await one(`select count(*)::int as n from pg_trigger where tgname = 'members_erase_fortis_cards' and not tgisinternal`);
  check("removing a member's info reaches their cards", trig.n === 1);

  const drift = await one(`
    select count(*)::int as n from (
      select m.id from members m left join points_ledger l on l.member_id = m.id
      group by m.id, m.points having m.points <> coalesce(sum(l.delta), 0)) d`);
  check("every balance matches its history", drift.n === 0, drift.n ? `${drift.n} member(s) out of step` : "");
  const orphan = await one(`select count(*)::int as n from fortis_cards where granted_at is not null and grant_id is null`);
  check("every granted card belongs to a grant", orphan.n === 0, orphan.n ? `${orphan.n} cards` : "");
  const shares = await one(`
    select count(*)::int as n from fortis_backfill_grants g
    where g.points <> coalesce((select sum(granted_points) from fortis_cards f where f.grant_id = g.id), 0)`);
  check("each grant's card shares add up", shares.n === 0, shares.n ? `${shares.n} grants` : "");
  const rowsPerGrant = await one(`
    select count(*)::int as n from (
      select g.member_id from fortis_backfill_grants g join members m on m.id = g.member_id and m.erased_at is null
      group by g.member_id
      having count(*) filter (where g.points > 0) <> (select count(*) from points_ledger l where l.member_id = g.member_id and l.reason = 'backfill')) x`);
  check("one 'backfill' history row per paying grant", rowsPerGrant.n === 0, rowsPerGrant.n ? `${rowsPerGrant.n} members` : "");
  const counts = await one(
    `select count(*)::int as cards, count(*) filter (where granted_at is not null)::int as granted, count(*) filter (where decision = 'approved' and granted_at is null)::int as approved from fortis_cards`,
  );
  console.log(`      (${counts.cards} cards loaded, ${counts.approved} approved and waiting, ${counts.granted} granted)`);

  if (EXERCISE) {
    await c.query("begin");
    const emp = (await one("select id from employees where active order by created_at limit 1"))?.id ?? null;
    const m = (await one("insert into members (name, email, tier, points) values ('Backfill Check', 'backfill-check@example.invalid', 'Insiders', 0) returning id")).id;
    const card = (await one("insert into fortis_cards (card_key, sale_count, sales_total, matched_member_id, match_status, match_kind, decision) values ('0000009999', 3, 120, $1, 'matched', 'name', 'approved') returning id", [m])).id;
    const grants = JSON.stringify([{ member_id: m, points: 110, dollars: 120, cards: [{ id: card, points: 110 }] }]);
    const r = (await one("select grant_fortis_backfill($1::jsonb, '{\"rate\":1}'::jsonb, 'Points from card purchases before the new system', $2) as r", [grants, emp])).r;
    const bal = await one("select points from members where id = $1", [m]);
    const led = await one("select count(*)::int as n, sum(delta) as s from points_ledger where member_id = $1 and reason = 'backfill'", [m]);
    check("grant pays through the points history", r.points === 110 && Number(bal.points) === 110 && led.n === 1 && Number(led.s) === 110, JSON.stringify(r));
    let again = null;
    try {
      await c.query("savepoint s");
      await c.query("select grant_fortis_backfill($1::jsonb, '{}'::jsonb, 'x', null)", [grants]);
    } catch (e) {
      again = e.code;
      await c.query("rollback to savepoint s");
    }
    check("a second grant of the same card is refused", again === "P0001");
    const card2 = (await one("insert into fortis_cards (card_key, sale_count, sales_total, matched_member_id, match_status, decision) values ('0000009998', 1, 10, $1, 'matched', 'skipped') returning id", [m])).id;
    let skipped = null;
    try {
      await c.query("savepoint s2");
      await c.query("select grant_fortis_backfill($1::jsonb, '{}'::jsonb, 'x', null)", [JSON.stringify([{ member_id: m, points: 9, dollars: 10, cards: [{ id: card2, points: 9 }] }])]);
    } catch (e) {
      skipped = e.code;
      await c.query("rollback to savepoint s2");
    }
    check("a skipped card can't be granted", skipped === "P0001");
    await c.query("update fortis_cards set holder_name = 'Backfill Check', name_keys = '{backfill check}' where id = $1", [card2]);
    await c.query("update members set erased_at = now() where id = $1", [m]);
    const after = await one("select holder_name, name_keys, matched_member_id, decision, erased_at is not null as erased from fortis_cards where id = $1", [card2]);
    check("removing their info clears the card's name and link", after.holder_name === null && after.name_keys.length === 0 && after.matched_member_id === null && after.erased, JSON.stringify(after));
    await c.query("rollback");
  }
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nAll passed.");
process.exit(failures ? 1 : 0);
