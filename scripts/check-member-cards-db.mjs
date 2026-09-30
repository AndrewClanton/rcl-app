// Card-linked points in the database (migration 20261001100000): is it
// applied, and is it locked down? Read-only: every query runs inside a
// read-only transaction that is rolled back, and it prints yes/no answers
// and counts only, never a card, a fingerprint or a name. Run it after the
// migration is applied and before the app code that uses it goes live.
//
//  - member_cards and card_payments exist, each with row level security on
//    and no policies (so only the server can read or change them), and the
//    card codes aren't on orders (which signed-in staff screens can read).
//  - orders has member_source; members has link_cards (on by default).
//  - credit_card_sale, credit_card_booking, undo_card_sale and
//    undo_card_booking exist, run as their owner, and the website's public
//    roles (anon, authenticated) can't call them.
//  - Removing a member's personal info also removes their cards (the
//    members_erase_cards trigger).
//  - Counts: cards linked (live and test), removed links, card payments
//    saved, points paid by a card, undone.
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
    for (const t of ["member_cards", "card_payments"]) {
      const there = await one("select to_regclass($1) is not null as ok", [`public.${t}`]);
      check(`${t} exists`, there.ok);
      if (!there.ok) continue;
      const rls = await one("select relrowsecurity as on from pg_class where oid = $1::regclass", [`public.${t}`]);
      check(`${t}: row level security is on`, rls.on === true);
      const pol = await one("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1", [t]);
      check(`${t}: no policies (server only)`, pol.n === 0, `${pol.n} found`);
    }

    const cols = await db.query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and ((table_name = 'orders' and column_name like any($1)) or (table_name = 'members' and column_name = 'link_cards'))`,
      [["member_source", "card\\_%"]],
    );
    const have = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    check("orders.member_source", have.has("orders.member_source"));
    const cardCols = [...have].filter((c) => c.startsWith("orders.card_"));
    check("no card codes on orders (staff screens can read orders)", cardCols.length === 0, cardCols.join(", "));
    check("members.link_cards", have.has("members.link_cards"));
    const def = await one("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'link_cards'");
    check("linking is on unless a member turns it off", def?.column_default === "true", def?.column_default ?? "no default");

    for (const [fn, args] of [
      ["credit_card_sale", "uuid, uuid, text, text, uuid"],
      ["credit_card_booking", "uuid, uuid, text"],
      ["undo_card_sale", "uuid, boolean, uuid"],
      ["undo_card_booking", "uuid, boolean, uuid"],
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
              count(*) filter (where removed_at is not null and (brand is not null or last4 is not null))::int as removed_labeled,
              count(distinct member_id) filter (where removed_at is null)::int as members
       from member_cards`,
    );
    check("removed links keep no card type or last four", n.removed_labeled === 0, `${n.removed_labeled} found`);
    const p = await one(
      `select count(*) filter (where order_id is not null)::int as sales,
              count(*) filter (where booking_id is not null)::int as bookings,
              count(*) filter (where credited_member_id is not null and undone_at is null)::int as credited,
              count(*) filter (where undone_at is not null)::int as undone
       from card_payments`,
    );
    console.log(`\nLinked cards: ${n.live} live, ${n.test} test, on ${n.members} member${n.members === 1 ? "" : "s"}; ${n.removed} removed.`);
    console.log(`Card payments saved: ${p.sales} register sales, ${p.bookings} online bookings. Points paid by a card: ${p.credited} (${p.undone} undone).`);
  }
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nDone.");
process.exit(failures ? 1 : 0);
