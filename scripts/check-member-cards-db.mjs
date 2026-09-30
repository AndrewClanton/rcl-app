// Card-linked points in the database (migration 20261001100000): is it
// applied, and is it locked down? Read-only: every query runs inside a
// read-only transaction that is rolled back, and it prints yes/no answers
// and counts only, never a card, a fingerprint or a name. Run it after the
// migration is applied and before the app code that uses it goes live.
//
//  - member_cards exists, with row level security on and no policies (so
//    only the server can read or change it).
//  - orders has the card columns; members has link_cards (on by default).
//  - attach_card_member and undo_card_match exist, and the website's
//    public roles (anon, authenticated) can't call them.
//  - Removing a member's personal info also removes their cards (the
//    members_erase_cards trigger).
//  - Counts: cards linked (live and test), removed links, sales found by a
//    card.
//
// Usage: node scripts/check-member-cards-db.mjs
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const db = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
try {
  await db.query("begin read only");

  const table = await one("select to_regclass('public.member_cards') is not null as ok");
  if (!table.ok) {
    console.log("member_cards isn't there: migration 20261001100000 isn't applied yet. Nothing else to check.");
  } else {
    check("member_cards exists", true);
    const rls = await one("select relrowsecurity as on from pg_class where oid = 'public.member_cards'::regclass");
    check("row level security is on", rls.on === true);
    const pol = await one("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'member_cards'");
    check("no policies (server only)", pol.n === 0, `${pol.n} found`);

    const cols = await db.query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and ((table_name = 'orders' and column_name = any($1)) or (table_name = 'members' and column_name = 'link_cards'))`,
      [["card_fingerprint", "card_livemode", "card_brand", "card_last4", "card_wallet", "member_source"]],
    );
    const have = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    for (const c of ["card_fingerprint", "card_livemode", "card_brand", "card_last4", "card_wallet", "member_source"]) check(`orders.${c}`, have.has(`orders.${c}`));
    check("members.link_cards", have.has("members.link_cards"));
    const def = await one("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'link_cards'");
    check("linking is on unless a member turns it off", def?.column_default === "true", def?.column_default ?? "no default");

    for (const [fn, args] of [
      ["attach_card_member", "uuid, uuid, text, uuid"],
      ["undo_card_match", "uuid, uuid"],
    ]) {
      const f = await one("select to_regprocedure($1) as p", [`public.${fn}(${args})`]);
      check(`${fn} exists`, !!f.p);
      if (!f.p) continue;
      const g = await one(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as service, (select prosecdef from pg_proc where oid = $1::regprocedure) as definer`,
        [`public.${fn}(${args})`],
      );
      check(`${fn}: the website's public roles can't call it`, !g.anon && !g.auth);
      check(`${fn}: the server can`, g.service === true);
      check(`${fn}: runs as its owner (security definer)`, g.definer === true);
    }

    const trig = await one("select count(*)::int as n from pg_trigger where tgname = 'members_erase_cards' and tgrelid = 'public.members'::regclass and not tgisinternal");
    check("removing a member's personal info removes their cards", trig.n === 1);

    const n = await one(
      `select count(*) filter (where removed_at is null and livemode)::int as live,
              count(*) filter (where removed_at is null and not livemode)::int as test,
              count(*) filter (where removed_at is not null)::int as removed,
              count(distinct member_id) filter (where removed_at is null)::int as members
       from member_cards`,
    );
    const s = await one("select count(*)::int as matched from orders where member_source = 'card' and member_id is not null");
    console.log(`\nLinked cards: ${n.live} live, ${n.test} test, on ${n.members} member${n.members === 1 ? "" : "s"}; ${n.removed} removed.`);
    console.log(`Sales found by a card: ${s.matched}.`);
  }
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nDone.");
process.exit(failures ? 1 : 0);
