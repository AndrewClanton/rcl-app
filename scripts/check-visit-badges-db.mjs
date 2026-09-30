// Check-ins, badges and the week streak against the live database
// (recordVisit in src/lib/visits-server.ts, member_week_streak and
// award_member_visit from migration 20260930030000). Safe to run anytime:
// it uses three throwaway members with no contact details, every visit is
// dated in 2019 (before the Royale's records start, so nothing shows on
// the register's "Here today" and the weeks between are closed), and it
// deletes everything it made at the end, whatever happens.
//
//  - A first visit: 5 points and Welcome (+50), paid once, in the history.
//  - Again the same day (and at 3:30 the next morning): nothing more.
//  - 4 weeks in a row: the 4 Weeks badge. A closed week in the middle
//    doesn't break the streak; a missed open week does. The database's
//    count agrees with lib/visits.ts on every one of these days.
//  - Early Riser, Night Owl and a Birthday Visit (with its year).
//  - Two registers confirming at once: one visit, one payment, one set of
//    badges (for a regular and for someone brand new).
//  - A visit whose payment never happened gets paid on the next try.
//  - Badges missed earlier are caught up; 13 weeks in a row (across the
//    November clock change) gives A Season and a free popcorn.
//
// Usage: node scripts/check-visit-badges-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const { recordVisit } = await import("../src/lib/visits-server.ts");
const { weekStart, weekStreak } = await import("../src/lib/visits.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const rows = async (sql, params) => (await c.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];

const NAMES = ["Visitcheck Alpha", "Visitcheck Bravo", "Visitcheck Charlie"];
const db = createAdminClient();
const ids = [];
// Central daylight (UTC-5) and standard (UTC-6) time.
const cdt = (date, time) => new Date(`${date}T${time}:00-05:00`);
const cst = (date, time) => new Date(`${date}T${time}:00-06:00`);
const keys = (r) => (r?.badges ?? []).map((b) => b.key).sort().join(",");

try {
  const quiet = await one(
    `select (select count(*) from member_visits where business_date between '2019-01-01' and '2020-01-31')::int as visits,
            (select count(*) from orders where created_at between '2019-01-01' and '2020-02-01')::int as orders,
            (select count(*) from members where name = any($1))::int as leftovers`,
    [NAMES],
  );
  if (quiet.visits || quiet.orders || quiet.leftovers) throw new Error(`2019 isn't quiet (or an earlier run left rows): ${JSON.stringify(quiet)}`);

  for (const name of NAMES) {
    const { data, error } = await db.from("members").insert({ name }).select("id").single();
    if (error) throw error;
    ids.push(data.id);
  }
  const [A, B, C] = ids;
  const ledger = async (m) => rows("select reason, delta::float as delta, note from points_ledger where member_id = $1 order by created_at, reason desc", [m]);
  const balance = async (m) => Number((await one("select points from members where id = $1", [m])).points);
  const sqlStreak = async (m, date) => (await one("select member_week_streak($1, $2::date) as n", [m, date])).n;

  // ---------- first visit ----------
  let r = await recordVisit(A, null, cdt("2019-06-05", "20:00"));
  check("first visit: 5 points and Welcome", r && !r.alreadyToday && r.visitPoints === 5 && keys(r) === "welcome" && r.earned === 55 && r.balance === 55, JSON.stringify(r));
  check("  week streak 1, 1 visit, no rewards", r?.weekStreak === 1 && r.visits === 1 && r.rewards.length === 0);
  const v1 = await one("select business_date::text as d, streak, points_awarded::float as paid from member_visits where member_id = $1", [A]);
  check("  the visit row: that business day, streak 1, 55 paid", v1.d === "2019-06-05" && v1.streak === 1 && v1.paid === 55, JSON.stringify(v1));
  const l1 = await ledger(A);
  check(
    "  points history: 'Check-in' +5 and 'Welcome' +50",
    l1.length === 2 && l1.some((l) => l.reason === "visit" && l.delta === 5 && l.note === "Check-in") && l1.some((l) => l.reason === "badge" && l.delta === 50 && l.note === "Welcome"),
    JSON.stringify(l1),
  );
  const b1 = await one("select badge, period, points, visit_id is not null as linked from member_badges where member_id = $1", [A]);
  check("  the badge row, linked to the visit", b1?.badge === "welcome" && b1.period === "" && b1.points === 50 && b1.linked);

  // ---------- the same day again ----------
  r = await recordVisit(A, null, cdt("2019-06-05", "21:00"));
  check("again the same evening: already, nothing paid", r?.alreadyToday && r.earned === 0 && r.badges.length === 0 && r.balance === 55 && r.weekStreak === 1, JSON.stringify(r));
  r = await recordVisit(A, null, cdt("2019-06-06", "03:30"));
  check("3:30 the next morning is the same business day: already (and no Night Owl)", r?.alreadyToday && r.earned === 0 && r.balance === 55);
  check("  still one visit, two history lines", (await one("select count(*)::int as n from member_visits where member_id = $1", [A])).n === 1 && (await ledger(A)).length === 2);

  // ---------- weeks in a row ----------
  r = await recordVisit(A, null, cdt("2019-06-12", "20:00"));
  check("week 2: 5 points, streak 2", r?.weekStreak === 2 && r.earned === 5 && r.badges.length === 0);
  r = await recordVisit(A, null, cdt("2019-06-19", "20:00"));
  check("week 3: streak 3", r?.weekStreak === 3 && r.earned === 5);
  r = await recordVisit(A, null, cdt("2019-06-26", "20:00"));
  check("week 4: the 4 Weeks badge (+25)", r?.weekStreak === 4 && keys(r) === "weeks_4" && r.earned === 30 && r.balance === 95, JSON.stringify(r));
  // Nobody comes in the week of Jul 1 (closed).
  r = await recordVisit(A, null, cdt("2019-07-10", "07:30"));
  check("after a closed week: streak 5, not broken", r?.weekStreak === 5, JSON.stringify(r));
  check("  7:30 AM: Early Riser (+25)", keys(r) === "early_riser" && r.earned === 30 && r.balance === 125);
  // Bravo comes in the week of Jul 15, so it's open; Alpha misses it.
  r = await recordVisit(B, null, cdt("2019-07-17", "20:00"));
  check("Bravo's first visit: Welcome", keys(r) === "welcome" && r.balance === 55);
  r = await recordVisit(A, null, cdt("2019-07-24", "23:30"));
  check("after a missed open week: streak back to 1", r?.weekStreak === 1, JSON.stringify(r));
  check("  11:30 PM: Night Owl (+25)", keys(r) === "night_owl" && r.earned === 30 && r.balance === 155);

  // The database and lib/visits.ts count the same way.
  const aDates = (await rows("select business_date::text as d from member_visits where member_id = $1", [A])).map((x) => x.d);
  const openWeeks = new Set((await rows("select business_date::text as d from member_visits where member_id = any($1)", [ids])).map((x) => weekStart(x.d)));
  const days = ["2019-06-05", "2019-06-26", "2019-07-03", "2019-07-10", "2019-07-12", "2019-07-17", "2019-07-24", "2019-07-28"];
  const got = [];
  for (const d of days) got.push([await sqlStreak(A, d), weekStreak(d, aDates, (m) => openWeeks.has(m))]);
  check("member_week_streak agrees with lib/visits.ts", got.every(([a, b]) => a === b), JSON.stringify(got));
  check("  in the closed week (Jul 3): the 4 so far still stand", got[2][0] === 4);
  check("  in the missed open week (Jul 17): still 5, until it's over", got[5][0] === 5);

  // ---------- birthday ----------
  await c.query("update members set birthday = '2000-07-31' where id = $1", [A]);
  r = await recordVisit(A, null, cdt("2019-08-01", "20:00"));
  check("a visit in their birthday week: Birthday Visit (+50)", keys(r) === "birthday" && r.earned === 55 && r.weekStreak === 2, JSON.stringify(r));
  const bday = await one("select period from member_badges where member_id = $1 and badge = 'birthday'", [A]);
  check("  for the year 2019", bday?.period === "2019");

  // ---------- two registers at once ----------
  const [x, y] = await Promise.all([recordVisit(A, null, cdt("2019-08-07", "20:00")), recordVisit(A, null, cdt("2019-08-07", "20:00"))]);
  check("two registers at once: exactly one pays", [x, y].filter((z) => z && !z.alreadyToday).length === 1 && [x, y].filter((z) => z?.alreadyToday).length === 1, JSON.stringify([x, y]));
  const aug7 = await one("select count(*)::int as n from member_visits where member_id = $1 and business_date = '2019-08-07'", [A]);
  check("  one visit row", aug7.n === 1);
  check("  one payment: balance 210 + 5 = 215", (await balance(A)) === 215);
  const [p, q] = await Promise.all([recordVisit(C, null, cdt("2019-06-05", "19:00")), recordVisit(C, null, cdt("2019-06-05", "19:00"))]);
  const paid = [p, q].find((z) => z && !z.alreadyToday);
  check("someone new, confirmed on two registers at once: one Welcome", !!paid && keys(paid) === "welcome" && [p, q].filter((z) => z?.alreadyToday).length === 1, JSON.stringify([p, q]));
  const cLedger = await ledger(C);
  const cBadges = await one("select count(*)::int as n from member_badges where member_id = $1", [C]);
  check("  paid once: 55 points, two history lines, one badge", (await balance(C)) === 55 && cLedger.length === 2 && cBadges.n === 1, JSON.stringify(cLedger));

  // ---------- a payment that never happened ----------
  await c.query("insert into member_visits (member_id, business_date, checked_in_at) values ($1, '2019-08-14', '2019-08-15T01:00:00Z')", [A]);
  r = await recordVisit(A, null, cdt("2019-08-14", "20:30"));
  check("a visit left unpaid is paid by the next try", r && !r.alreadyToday && r.visitPoints === 5 && (await balance(A)) === 220, JSON.stringify(r));
  r = await recordVisit(A, null, cdt("2019-08-14", "21:00"));
  check("  and only once", r?.alreadyToday && (await balance(A)) === 220);

  // ---------- milestones ----------
  r = await recordVisit(A, null, cdt("2019-08-21", "20:00"));
  check("the 10th visit: Regular (+25)", r?.visits === 10 && keys(r) === "visits_10" && r.earned === 30, JSON.stringify(r));

  // ---------- catching up, and 13 weeks ----------
  // Bravo's next 12 weeks are recorded straight in (as if their badges had
  // failed to pay), then the 13th goes through recordVisit.
  const wednesdays = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2019, 8, 4 + 7 * i));
    return d.toISOString().slice(0, 10);
  });
  for (const d of wednesdays) await c.query("insert into member_visits (member_id, business_date, streak, points_awarded) values ($1, $2, 1, 5)", [B, d]);
  check("(Bravo's weeks run Sep 4 to Nov 20, 2019, across the clock change)", wednesdays[0] === "2019-09-04" && wednesdays[11] === "2019-11-20");
  r = await recordVisit(B, null, cst("2019-11-27", "20:00"));
  check("13 weeks in a row: A Season, plus the missed 4 Weeks and Regular", r?.weekStreak === 13 && keys(r) === "visits_10,weeks_13,weeks_4", JSON.stringify(r));
  check("  paying 5 + 75 + 25 + 25, and a free popcorn", r?.earned === 130 && r.rewards.join() === "popcorn" && r.balance === 185);
  const pop = await one("select kind, reason, earned_on::text as d, redeemed_at from member_rewards where member_id = $1", [B]);
  check("  the popcorn is waiting at the register", pop?.kind === "popcorn" && pop.reason === "A Season badge: 13 weeks in a row" && pop.d === "2019-11-27" && !pop.redeemed_at, JSON.stringify(pop));
  r = await recordVisit(B, null, cst("2019-12-04", "20:00"));
  check("week 14: no badge twice", r?.weekStreak === 14 && r.badges.length === 0 && r.earned === 5);
} catch (e) {
  failures++;
  console.log("ERROR", e.message ?? e);
} finally {
  // Deleting the members takes their visits, badges, rewards and points
  // history with them (on delete cascade).
  if (ids.length) await db.from("members").delete().in("id", ids);
  const left = await one(
    `select (select count(*) from members where name = any($1))::int as members,
            (select count(*) from member_visits where member_id = any($2::uuid[]) or business_date between '2019-01-01' and '2020-01-31')::int as visits,
            (select count(*) from member_badges where member_id = any($2::uuid[]))::int as badges,
            (select count(*) from member_rewards where member_id = any($2::uuid[]))::int as rewards,
            (select count(*) from points_ledger where member_id = any($2::uuid[]))::int as ledger`,
    [NAMES, ids],
  );
  check("cleaned up after itself", Object.values(left).every((n) => n === 0), JSON.stringify(left));
  await c.end();
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll visit-badge database checks passed.");
process.exit(failures ? 1 : 0);
