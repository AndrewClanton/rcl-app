// "Ran out" (86 it) against the live database, through the real server
// actions, with throwaway rows that are always deleted at the end: two par
// sheet lines and three menu items, all switched off (active = false), so
// they never show on the register, its par sheet count or the public menu.
// The check's "Ran out" reports, their change-log lines and its rate-limit
// counts are deleted too. Real menu items are never 86'd.
//
//  - The sheet's options: the par sheet, the menu (no tickets), and which
//    menu items' recipes use each par line.
//  - Search: "hot dog b" and "buns" find Hot dog buns; Hot dog buns suggests
//    Hot dog (regular).
//  - Every refusal: bad ids, missing par line or menu item, too long.
//  - Report, report the same line again (adds to it), a second report
//    stopping the same item, It's back, Bought it (the item stays out for
//    the other report), False alarm, a typed (off-sheet) report closed from
//    the menu button with "Found some".
//  - The register's poll, the par count hint, the shopping list, History,
//    Back office → Menu's Clear, and the daily email's "Ran out today".
//
// Usage: node scripts/check-ran-out-db.mjs   (Node 23.6+ runs the .ts directly)
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

const migrated = (await q("select count(*)::int as n from information_schema.columns where table_name = 'menu_items' and column_name in ('out_since', 'out_note', 'out_outage_id')"))[0].n === 3;
if (!migrated) {
  console.log("The stock_outages migration (20260930030000) isn't applied yet. Apply it first.");
  await c.end();
  process.exit(1);
}

// The actions check the staff session; here it's a manager from the staff
// list (so the change log can name someone), without signing in.
const staff = (await q("select id, name from employees where active and role in ('owner', 'admin', 'manager') order by name limit 1"))[0];
if (!staff) throw new Error("No active manager to act as.");
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

const ranOut = await import("../src/app/pos/ran-out-actions.ts");
const ops = await import("../src/app/pos/ops-actions.ts");
const { currentOuts } = await import("../src/lib/ops/outages.ts");
const search = await import("../src/lib/ops/ran-out-search.ts");
const menuAdmin = await import("../src/app/admin/menu/actions.ts");

const TAG = "Ran-out check (delete me)";
const made = { par: [], menu: [] };
const item = async (id) => (await q("select out_since, out_note, out_outage_id from menu_items where id = $1", [id]))[0];
const outage = async (id) => (await q("select * from stock_outages where id = $1", [id]))[0];

try {
  // ---------- the sheet's options (read only) ----------
  const opts = await ranOut.getRanOutOptions();
  const buns = opts.parItems.find((p) => p.name === "Hot dog buns");
  check("options: the par sheet is there", opts.parItems.length > 10 && !!buns, `${opts.parItems.length} lines`);
  const hotDog = opts.menu.find((m) => m.name === "Hot dog (regular)");
  check("options: the register's menu, Hot dog (regular) in it", !!hotDog, hotDog?.category);
  const ticketCats = (await q("select mc.label from menu_categories mc left join menu_categories p on p.id = mc.parent_id where mc.key = 'tickets' or p.key = 'tickets'")).map((r) => r.label);
  check("options: no tickets on the menu list", !opts.menu.some((m) => ticketCats.some((t) => m.category.startsWith(t))));
  const expected = await q(
    `select distinct i.par_item_id, r.menu_item_id from ingredients i
     join recipe_ingredients ri on ri.ingredient_id = i.id join recipes r on r.id = ri.recipe_id join menu_items mi on mi.id = r.menu_item_id
     where i.par_item_id is not null and mi.active`,
  );
  const got = Object.entries(opts.recipeUses).flatMap(([p, ms]) => ms.map((m) => `${p}:${m}`)).sort();
  const want = expected.map((r) => `${r.par_item_id}:${r.menu_item_id}`).filter((k) => opts.menu.some((m) => k.endsWith(m.id))).sort();
  check("options: recipe links (par line → menu items) match the recipes", JSON.stringify(got) === JSON.stringify(want), `${got.length} links`);

  // ---------- search ----------
  check('search: "hot dog b" finds Hot dog buns first', search.searchPar("hot dog b", opts.parItems)[0]?.name === "Hot dog buns", search.searchPar("hot dog b", opts.parItems).map((p) => p.name).join(", "));
  check('search: "buns" finds Hot dog buns', search.searchPar("buns", opts.parItems).some((p) => p.name === "Hot dog buns"));
  // Typos are forgiven from 4 letters (the recipe editor's matcher).
  check('search: "hot dog bnus" (typo) still finds it', search.searchPar("hot dog bnus", opts.parItems)[0]?.name === "Hot dog buns");
  const sugg = search.suggestMenuItems("Hot dog buns", "Hot dogs", opts.menu).map((m) => m.name);
  check("suggest: Hot dog buns → Hot dog (regular)", sugg.includes("Hot dog (regular)"), sugg.join(", "));
  check('menu search: "hot dog" finds Hot dog (regular)', search.searchMenu("hot dog", opts.menu).some((m) => m.name === "Hot dog (regular)"));

  // ---------- throwaway rows (all switched off) ----------
  const cat = (await q("select id from menu_categories where parent_id is null and key <> 'tickets' order by sort_order limit 1"))[0].id;
  for (const [name, section] of [["Ran-out check buns", "Hot dogs"], ["Ran-out check dogs", "Hot dogs"]]) {
    made.par.push((await q("insert into par_items (area, section, name, par_qty, unit, source, sort_order, active) values ($1, $2, $3, 2, 'sleeves', 'Check store', 99999, false) returning id", [TAG, section, name]))[0].id);
  }
  for (const n of [1, 2, 3]) {
    made.menu.push((await q("insert into menu_items (category_id, name, price, sort_order, active) values ($1, $2, 0, 99999, false) returning id", [cat, `Ran-out check dog ${n} (delete me)`]))[0].id);
  }
  const [P1, P2] = made.par;
  const [M1, M2, M3] = made.menu;
  const me = staff.id;

  // ---------- refusals ----------
  const refuse = async (label, input) => {
    const r = await ranOut.reportOutage({ parItemId: null, label: null, note: null, menuItemIds: [], ...input }, me, null);
    check(`refused: ${label}`, r.ok === false, r.ok ? "saved!" : r.error);
  };
  await refuse("nothing said", {});
  await refuse("a par id that isn't an id", { parItemId: "buns" });
  await refuse("a par line that doesn't exist", { parItemId: "00000000-0000-4000-8000-000000000000" });
  await refuse("a menu id that isn't an id", { parItemId: P1, menuItemIds: ["hot dog"] });
  await refuse("a menu item that doesn't exist", { parItemId: P1, menuItemIds: [M1, "00000000-0000-4000-8000-000000000000"] });
  await refuse("what ran out, too long", { label: "x".repeat(81) });
  await refuse("a note too long", { parItemId: P1, note: "x".repeat(301) });
  await refuse("too many menu items", { parItemId: P1, menuItemIds: Array.from({ length: 41 }, () => M1) });
  check("refusals saved nothing", (await q("select count(*)::int as n from stock_outages where par_item_id = any($1)", [made.par]))[0].n === 0);

  // ---------- report ----------
  const r1 = await ranOut.reportOutage({ parItemId: P1, label: null, note: "used the last sleeve", menuItemIds: [M1, M2] }, me, "not-a-shift");
  check("report: saved", r1.ok && r1.added, r1.ok ? r1.name : r1.error);
  const O1 = r1.outageId;
  const o1 = await outage(O1);
  check("report: row has the par line, its name, who, the note, no shift", o1.par_item_id === P1 && o1.label === "Ran-out check buns" && o1.reported_by === me && o1.note === "used the last sleeve" && o1.shift_id === null);
  const i1 = await item(M1);
  check("report: menu items 86'd with the reason", !!i1.out_since && i1.out_note === "Out of ran-out check buns" && i1.out_outage_id === O1, i1.out_note);
  check("report: logged for History", (await q("select count(*)::int as n from ops_changes where entity = 'outage' and entity_id = $1 and action = 'reported' and summary like 'Ran out of Ran-out check buns%' and changed_by = $2", [O1, me]))[0].n === 1);

  const poll = await currentOuts();
  const p1 = poll.outs.find((o) => o.itemId === M1);
  check("poll: the register sees the 86 and what ran out", !!p1 && p1.what === "Ran-out check buns" && p1.outageId === O1 && poll.open >= 1);
  const status = await ops.getShiftStatus();
  check("poll: getShiftStatus carries outs and the open count", status.outs.some((o) => o.itemId === M1) && status.ranOut >= 1);
  const sheet = await ops.getParSheet();
  check("par count: the line shows it was reported out", !!sheet.outs[P1]);
  check("options: the line shows as already out", !!(await ranOut.getRanOutOptions()).open[P1]);

  // Same line again, one more item: added to the open report.
  const since1 = i1.out_since;
  const r2 = await ranOut.reportOutage({ parItemId: P1, label: null, note: "second sleeve too", menuItemIds: [M1, M3] }, me, null);
  check("again: adds to the open report", r2.ok && !r2.added && r2.outageId === O1);
  const o1b = await outage(O1);
  check("again: stopped list and note merged", o1b.stopped_item_ids.length === 3 && o1b.note === "used the last sleeve / second sleeve too", o1b.note);
  check("again: an item already out keeps its time", String((await item(M1)).out_since) === String(since1));
  check("again: one open report per par line", (await q("select count(*)::int as n from stock_outages where par_item_id = $1 and resolved_at is null", [P1]))[0].n === 1);

  // A second report stopping M1 too.
  const r3 = await ranOut.reportOutage({ parItemId: P2, label: null, note: null, menuItemIds: [M1] }, me, null);
  const O2 = r3.ok ? r3.outageId : null;
  check("second report: M1 now shows the newer reason", r3.ok && (await item(M1)).out_outage_id === O2 && (await item(M1)).out_note === "Out of ran-out check dogs");

  const open = await ranOut.getOpenOutages();
  const s1 = open.find((o) => o.id === O1);
  check("shopping list: both open, with par, unit, store, who", !!s1 && open.some((o) => o.id === O2) && s1.parQty === 2 && s1.unit === "sleeves" && s1.source === "Check store" && !!s1.byName, s1 && `${s1.name} · ${s1.byName}`);
  check("shopping list: what each report still stops", JSON.stringify(s1?.stopped.sort()) === JSON.stringify(["Ran-out check dog 2 (delete me)", "Ran-out check dog 3 (delete me)"]), s1?.stopped.join(", "));

  // It's back on M2 (no resolution): only M2 clears.
  const b1 = await ranOut.markItemBack(M2, null, me);
  check("It's back: M2 back on sale, report still open", b1.ok && !(await item(M2)).out_since && !(await outage(O1)).resolved_at);
  check("It's back: logged", (await q("select count(*)::int as n from ops_changes where entity = 'menu_item' and entity_id = $1 and action = 'restored'", [M2]))[0].n === 1);

  // Bought the dogs (O2): M1 is still out, for the buns (O1).
  const f2 = await ranOut.resolveOutage(O2, "bought", me);
  const m1 = await item(M1);
  check("Bought it: resolved as bought, by whom", f2.ok && (await outage(O2)).resolution === "bought" && (await outage(O2)).resolved_by === me);
  check("Bought it: M1 stays out, back to the buns report", !!m1.out_since && m1.out_outage_id === O1 && m1.out_note === "Out of ran-out check buns", m1.out_note);
  check("Bought it: nothing put back on sale", f2.ok && f2.back.length === 0);

  const again = await ranOut.resolveOutage(O2, "found", me);
  check("resolving twice changes nothing", again.ok && (await outage(O2)).resolution === "bought");
  const badRes = await ranOut.resolveOutage(O1, "stolen", me);
  check("refused: a resolution that isn't one", badRes.ok === false);
  const badId = await ranOut.resolveOutage("x", "bought", me);
  check("refused: an outage id that isn't an id", badId.ok === false);

  // False alarm on the buns: M1 and M3 go back on sale.
  const f1 = await ranOut.resolveOutage(O1, "mistake", me);
  check("False alarm: both items back on sale", f1.ok && f1.back.sort().join("|") === "Ran-out check dog 1 (delete me)|Ran-out check dog 3 (delete me)" && !(await item(M1)).out_since && !(await item(M3)).out_since, f1.ok ? f1.back.join(", ") : f1.error);
  check("False alarm: off the shopping list and the par hint", !(await ranOut.getOpenOutages()).some((o) => o.id === O1) && !(await ops.getParSheet()).outs[P1]);

  // Something not on the par sheet, closed from the menu button: "Found some".
  const r4 = await ranOut.reportOutage({ parItemId: null, label: "  Ran-out   check limes ", note: null, menuItemIds: [M3] }, null, null);
  const O4 = r4.ok ? r4.outageId : null;
  check("typed: saved with the name tidied, nobody named", r4.ok && (await outage(O4)).label === "Ran-out check limes" && (await outage(O4)).reported_by === null && (await outage(O4)).par_item_id === null);
  const b4 = await ranOut.markItemBack(M3, "found", me);
  check("It's back + found: item back and the report closed as found", b4.ok && !(await item(M3)).out_since && (await outage(O4)).resolution === "found");

  // Back office → Menu: Clear.
  const r5 = await ranOut.reportOutage({ parItemId: null, label: "Ran-out check cups", note: null, menuItemIds: [M2] }, me, null);
  const cleared = await menuAdmin.clearItemOut(M2);
  check("Back office Clear: item back on sale, report stays for the shopping list", r5.ok && cleared.ok && !(await item(M2)).out_since && !(await outage(r5.outageId)).resolved_at);
  const badClear = await menuAdmin.clearItemOut("nope");
  check("Back office Clear: refuses a bad id", badClear.ok === false);
  if (r5.ok) await ranOut.resolveOutage(r5.outageId, "mistake", me);

  // History and the daily email.
  const h = await ops.getOpsHistory(1);
  const lines = h.changes.filter((x) => x.entity === "outage" || x.entity === "menu_item").map((x) => x.summary);
  check("History: ran-out lines are there", lines.some((s) => s.startsWith("Ran out of Ran-out check buns")) && lines.some((s) => s.startsWith("Bought Ran-out check dogs")), `${lines.length} lines`);
  try {
    const { businessDay } = await import("../src/lib/ops/time.ts");
    const { buildDailyDigest } = await import("../src/lib/data/daily-digest.ts");
    const { dailyDigestHtml } = await import("../src/lib/email/daily-digest-email.ts");
    const d = await buildDailyDigest(businessDay().date);
    const mine = d.ranOut.filter((o) => o.what.startsWith("Ran-out check"));
    check("daily email: today's reports, false alarms left out", mine.some((o) => o.what === "Ran-out check dogs" && o.bought) && mine.some((o) => o.what === "Ran-out check limes" && o.status.startsWith("Found")) && !mine.some((o) => o.what === "Ran-out check buns"), mine.map((o) => `${o.what}: ${o.status}`).join("; "));
    const html = dailyDigestHtml(d, "https://example.invalid/report");
    check("daily email: a Ran out today section", html.includes("Ran out today") && html.includes("Ran-out check dogs"));
  } catch (e) {
    check("daily email built", false, e instanceof Error ? e.message : String(e));
  }
} finally {
  const outages = (await q("select id from stock_outages where par_item_id = any($1) or label like 'Ran-out check%'", [made.par])).map((r) => r.id);
  await q("delete from ops_changes where entity_id = any($1)", [[...outages, ...made.menu]]);
  await q("delete from stock_outages where id = any($1)", [outages]);
  await q("delete from menu_items where id = any($1)", [made.menu]);
  await q("delete from par_items where id = any($1)", [made.par]);
  await q("delete from rate_limit_hits where key = any($1)", [[`ran-out:${staff.id}`, `ran-out-fix:${staff.id}`]]).catch(() => {});
  const left = (await q(
    `select (select count(*) from stock_outages where label like 'Ran-out check%')::int as o,
            (select count(*) from menu_items where name like 'Ran-out check%')::int as m,
            (select count(*) from par_items where name like 'Ran-out check%')::int as p`,
  ))[0];
  console.log(`\nCleaned up: ${outages.length} reports, ${made.menu.length} menu items, ${made.par.length} par lines. Left behind: ${left.o + left.m + left.p}.`);
  await c.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
