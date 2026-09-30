// The par sheet's day merge, "Since the last count" and quarter counting,
// against the live database through the real server actions. Uses two
// throwaway par lines, switched off (active = false) so they never show on
// the register's count or shopping list, and three throwaway counts that
// only have lines for them: one yesterday, two today. All of it is deleted
// at the end, with the change-log lines the check made.
//
//  - Each item's latest line today, merged across saves (P1 counted in the
//    first save, P2 recounted in the second).
//  - The par sheet's "last count", the status poll, the shopping list (a
//    switched-off line is never on it) and the daily email all read the
//    merged lines.
//  - "Since the last count": yesterday's count against today's, biggest drop
//    first, "Used 1¼ bottles" / "Restocked 2 bottles".
//  - Quarter counting: the automatic rule, Count by, sizes, and refusals.
//  - The 20260930041000 migration's tidy-up: every line has a step, no
//    "reserve" units and no sizes left in brackets.
//
// Usage: node scripts/check-par-sheet-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

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
const q = async (sql, params = []) => (await c.query(sql, params)).rows;

const migrated = (await q("select count(*)::int as n from information_schema.columns where table_name = 'par_items' and column_name in ('count_step', 'unit_size')"))[0].n === 2;
if (!migrated) {
  console.log("The par sheet units migration (20260930041000) isn't applied yet. Apply it first.");
  await c.end();
  process.exit(1);
}

// The actions check the staff session; here it's a manager from the staff
// list (so counts and the change log can name someone), without signing in.
const staff = (await q("select id, name from employees where active and role in ('owner', 'admin', 'manager') order by name limit 1"))[0];
if (!staff) throw new Error("No active manager to act as.");
const first = staff.name.split(" ")[0];
const session = JSON.stringify({ employeeId: staff.id, name: staff.name, role: "manager", email: "check@invalid" });
const stubs = {
  "server-only": "",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "@/lib/auth": `const s = ${session};
    export async function assertStaff() { return s; }
    export async function getStaffSession() { return s; }
    export async function assertManager() { return s; }
    export function hasManagerAccess() { return true; }
    export function hasAdminAccess() { return true; }`,
};
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
      const stubs = ${JSON.stringify(stubs)};
      const srcRoot = ${JSON.stringify(srcRoot)};
      export async function resolve(s, ctx, next) {
        if (Object.hasOwn(stubs, s)) return { url: "data:text/javascript," + encodeURIComponent(stubs[s]), shortCircuit: true };
        if (s.startsWith("@/")) s = srcRoot + s.slice(2);
        const local = s.startsWith("./") || s.startsWith("../") || s.startsWith("file:");
        if (local && !/[.](ts|tsx|js|mjs|cjs|json)$/.test(s)) {
          try {
            return await next(s + ".ts", ctx);
          } catch {}
        }
        return next(s, ctx);
      }`),
);

const ops = await import("../src/app/pos/ops-actions.ts");
const shared = await import("../src/lib/ops/shared.ts");
const { latestLines } = await import("../src/lib/ops/par-counts.ts");
const time = await import("../src/lib/ops/time.ts");

const TAG = "Par check (delete me)";
const made = { par: [], counts: [] };

try {
  // ---------- pure helpers (no database) ----------
  const { autoStep, stepFor, qtyUnit, changeLabel, buyQty, parLabel } = shared;
  check("auto step: bottles, kegs, jugs, gallons, quarts, cartons count in quarters", ["bottles", "kegs", "jugs", "gallons", "quarts", "cartons", "bottle"].every((u) => autoStep(u, 2) === 0.25));
  check("auto step: spray bottles, boxes, bags, cases count whole", ["spray bottles", "boxes", "bags", "cases", "24-packs", null].every((u) => autoStep(u, 2) === 1));
  check("auto step: a fractional par counts in quarters", autoStep("boxes", 0.5) === 0.25 && autoStep("spray bottles", 0.5) === 0.25);
  check("step: Count by wins over automatic", stepFor({ unit: "bottles", par_qty: 2, count_step: 1 }) === 1 && stepFor({ unit: "boxes", par_qty: 2, count_step: 0.5 }) === 0.5 && stepFor({ unit: "bottles", par_qty: 2, count_step: null }) === 0.25);
  check('labels: "1¼ bottles", "¾ bottle", "1 box", "3 boxes"', qtyUnit(1.25, "bottles") === "1¼ bottles" && qtyUnit(0.75, "bottles") === "¾ bottle" && qtyUnit(1, "boxes") === "1 box" && qtyUnit(3, "boxes") === "3 boxes", `${qtyUnit(1.25, "bottles")} / ${qtyUnit(0.75, "bottles")} / ${qtyUnit(1, "boxes")}`);
  check('labels: par "½ bottle", "2 spray bottles"', parLabel({ par_qty: 0.5, unit: "bottles" }) === "½ bottle" && parLabel({ par_qty: 2, unit: "spray bottles" }) === "2 spray bottles");
  check('change: "Used 1¼ bottles", "Restocked 2 boxes", "No change"', changeLabel(-1.25, "bottles") === "Used 1¼ bottles" && changeLabel(2, "boxes") === "Restocked 2 boxes" && changeLabel(0, "boxes") === "No change");
  check("buy: a whole unit for any part of one", buyQty(0.25) === 1 && buyQty(1.25) === 2 && buyQty(2) === 2 && buyQty(0) === 0);

  // ---------- the migration's tidy-up ----------
  const tidy = (await q(`select count(*) filter (where count_step is null)::int as no_step,
      count(*) filter (where unit ~* '^\\s*reserve')::int as reserve,
      count(*) filter (where unit ~ '\\(')::int as bracket,
      count(*) filter (where unit in ('bottle', 'case', 'bag', 'sleeve', 'carton'))::int as singular
    from par_items where name not like 'Par check%'`))[0];
  check("migration: every line has a Count by, no reserve/bracket/singular units", tidy.no_step === 0 && tidy.reserve === 0 && tidy.bracket === 0 && tidy.singular === 0, JSON.stringify(tidy));
  const kernels = (await q("select unit, unit_size, count_step from par_items where name = 'Popcorn kernels' limit 1"))[0];
  check('migration: "bags (12.5 lb)" is now bags, 12.5 lb', !kernels || (kernels.unit === "bags" && kernels.unit_size === "12.5 lb"), kernels && `${kernels.unit} / ${kernels.unit_size}`);
  const rum = (await q("select unit, count_step from par_items where name = 'Well Rum' limit 1"))[0];
  check("migration: liquor counts in quarter bottles", !rum || (rum.unit === "bottles" && Number(rum.count_step) === 0.25), rum && `${rum.unit} / ${rum.count_step}`);
  check("migration: logged to History", (await q("select count(*)::int as n from ops_changes where entity = 'par_item' and entity_id is null and summary like 'the par sheet''s units%'"))[0].n === 1);

  // ---------- throwaway lines and counts ----------
  for (const [name, unit] of [["Par check one", "bottles"], ["Par check two", "bottles"]]) {
    made.par.push((await q("insert into par_items (area, section, name, par_qty, unit, source, sort_order, active) values ($1, 'Check', $2, 2, $3, 'Check store', 99999, false) returning id", [TAG, name, unit]))[0].id);
  }
  const [P1, P2] = made.par;
  const { start } = time.businessDayWindow(time.businessDay().date);
  const yesterday = new Date(Date.parse(start) - 20 * 3_600_000).toISOString();
  const c0 = (await q("insert into par_counts (counted_by, completed_at) values ($1, $2) returning id", [staff.id, yesterday]))[0].id;
  made.counts.push(c0);
  await q("insert into par_count_lines (count_id, item_id, qty, par_qty) values ($1, $2, 3, 2), ($1, $3, 1, 2)", [c0, P1, P2]);

  const s1 = await ops.submitParCount([{ itemId: P1, qty: 1.75 }, { itemId: P2, qty: 0 }], staff.id, null);
  if (s1.ok) made.counts.push(s1.countId);
  const s2 = await ops.submitParCount([{ itemId: P2, qty: 3 }], staff.id, null);
  if (s2.ok) made.counts.push(s2.countId);
  check("two saves today", s1.ok && s2.ok);

  // ---------- merged: each item's latest line today ----------
  const today = await latestLines({ since: start });
  check("merge: P1 from the first save, P2 from the second", today.get(P1)?.countId === s1.countId && today.get(P1)?.qty === 1.75 && today.get(P2)?.countId === s2.countId && today.get(P2)?.qty === 3);
  const before = await latestLines({ before: start });
  check("before today: yesterday's lines", before.get(P1)?.countId === c0 && before.get(P1)?.qty === 3 && before.get(P2)?.qty === 1);

  const sheet = await ops.getParSheet();
  check("par sheet: last count per item, whichever save", sheet.last[P1]?.qty === 1.75 && sheet.last[P2]?.qty === 3, `${sheet.last[P1]?.qty} / ${sheet.last[P2]?.qty}`);
  check("par sheet: items carry count_step and unit_size", sheet.items.every((i) => "count_step" in i && "unit_size" in i));

  const list = await ops.getShoppingList();
  check("shopping list: from today's counts, both saves listed", list?.today === true && list.counts.some((x) => x.id === s1.countId) && list.counts.some((x) => x.id === s2.countId), list?.counts.map((x) => x.byName).join(", "));
  check("shopping list: counts oldest first", !!list && list.counts.every((x, i, a) => i === 0 || Date.parse(a[i - 1].at) <= Date.parse(x.at)));
  check("shopping list: switched-off lines never on it", !!list && !list.bySource.some((g) => g.lines.some((l) => made.par.includes(l.itemId))) && !list.notCounted.some((n) => made.par.includes(n.itemId)));
  const lines = list?.bySource.flatMap((g) => g.lines) ?? [];
  check("shopping list: whole units to buy", lines.every((l) => Number.isInteger(l.buy) && l.buy >= l.need && l.buy > 0));

  const status = await ops.getShiftStatus();
  const total = list?.bySource.reduce((n, g) => n + g.lines.length, 0);
  check("status poll: the Shopping button's count is the list's", status.lastCount?.below === total && status.lastCount?.today === true, `${status.lastCount?.below} vs ${total}`);
  check("status poll: the latest save", status.lastCount?.at && Date.parse(status.lastCount.at) === Date.parse(list.counts.at(-1).at));

  // ---------- since the last count ----------
  const cmp = await ops.getCountComparison();
  const r1 = cmp?.rows.find((r) => r.itemId === P1);
  const r2 = cmp?.rows.find((r) => r.itemId === P2);
  check("since the last count: P1 used 1¼ bottles", r1?.prev?.qty === 3 && r1.now.qty === 1.75 && r1.diff === -1.25 && shared.changeLabel(r1.diff, r1.unit) === "Used 1¼ bottles", r1 && shared.changeLabel(r1.diff, r1.unit));
  check("since the last count: P2 restocked 2 bottles", r2?.prev?.qty === 1 && r2.now.qty === 3 && r2.diff === 2 && shared.changeLabel(r2.diff, r2.unit) === "Restocked 2 bottles");
  check("since the last count: previous count's date and who", r1?.prev?.at && Date.parse(r1.prev.at) === Date.parse(yesterday) && r1.prev.byName === first);
  const rank = (r) => (r.diff === null ? 3 : r.diff < 0 ? 0 : r.diff > 0 ? 1 : 2);
  const sorted = (cmp?.rows ?? []).every((r, i, a) => i === 0 || rank(a[i - 1]) < rank(r) || (rank(a[i - 1]) === rank(r) && Math.abs(a[i - 1].diff ?? 0) >= Math.abs(r.diff ?? 0)));
  check("since the last count: biggest drop first, then restocks, no change, first counts", sorted && cmp.rows.indexOf(r1) < cmp.rows.indexOf(r2));

  // ---------- the daily email ----------
  try {
    const { buildDailyDigest } = await import("../src/lib/data/daily-digest.ts");
    const d = await buildDailyDigest(time.businessDay().date);
    const line = d.watch.find((w) => w.startsWith("Below par on the day's par count"));
    // It names 8 and counts the rest; the throwaway lines sort last.
    const merged = await latestLines({ since: start });
    const low = [...merged.values()].filter((l) => l.par !== null && l.qty < l.par).length;
    const named = low > 8 ? line?.includes(`and ${low - 8} more`) : line?.includes("Par check one (1¾/2)");
    check("daily email: below par merged across the day's saves", !!line && named && !line.includes("Par check two"), `${low} below · ${line?.slice(0, 90)}…`);
  } catch (e) {
    check("daily email built", false, e instanceof Error ? e.message : String(e));
  }

  // ---------- editing a line: Count by and size ----------
  const base = { id: P1, area: TAG, section: "Check", name: "Par check one", par_qty: 2, unit: "bottles", source: "Check store" };
  const e1 = await ops.saveParItem({ ...base, unit_size: " 750  ml ", count_step: 0.5 }, staff.id);
  const row = (await q("select unit_size, count_step, par_qty from par_items where id = $1", [P1]))[0];
  check("edit: size tidied and Count by saved, par unchanged", e1.ok && row.unit_size === "750 ml" && Number(row.count_step) === 0.5 && Number(row.par_qty) === 2, `${row.unit_size} / ${row.count_step}`);
  const e2 = await ops.saveParItem({ ...base, unit_size: null, count_step: null }, staff.id);
  const row2 = (await q("select unit_size, count_step from par_items where id = $1", [P1]))[0];
  check("edit: back to Automatic, no size", e2.ok && row2.unit_size === null && row2.count_step === null);
  const bad1 = await ops.saveParItem({ ...base, count_step: 0.3 }, staff.id);
  check("refused: a Count by that isn't whole, halves or quarters", bad1.ok === false, bad1.ok ? "saved!" : bad1.error);
  const bad2 = await ops.saveParItem({ ...base, unit_size: "x".repeat(41) }, staff.id);
  check("refused: a size over 40 characters", bad2.ok === false, bad2.ok ? "saved!" : bad2.error);
} finally {
  await q("delete from par_counts where id = any($1)", [made.counts]);
  await q("delete from ops_changes where entity_id = any($1)", [made.par]);
  await q("delete from par_items where id = any($1)", [made.par]);
  const left = (await q(
    `select (select count(*) from par_items where name like 'Par check%')::int as p,
            (select count(*) from par_counts where id = any($1))::int as c,
            (select count(*) from par_count_lines where item_id = any($2))::int as l`,
    [made.counts, made.par],
  ))[0];
  console.log(`\nCleaned up: ${made.counts.length} counts, ${made.par.length} par lines. Left behind: ${left.p + left.c + left.l}.`);
  await c.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
