// "Ran out" (86 it) against the live database, through the real server
// actions, with throwaway rows that are always deleted at the end: two par
// sheet lines, three menu items and one staff member, all switched off
// (active = false), so they never show on the register's staff list, its
// par sheet count or the public menu. The check's "Ran out" reports, their
// restock to-dos, change-log lines and rate-limit counts are deleted too.
// Real menu items are never 86'd and no real to-do is touched. The restock
// to-dos exist for the few seconds the check runs; they're for the
// throwaway par lines and are closed or deleted right away.
//
//  - Pure: the restock to-do's words, ordinals, "Raise par?", and which
//    menu items a par line plainly is (strong name match).
//  - The sheet's options: the par sheet, the menu (no tickets), which menu
//    items' recipes use each par line (Hot dog buns → Hot dog, Pizza crust
//    → both pizzas, Popcorn kernels → every popcorn), and the strong name
//    matches on the real par sheet and menu.
//  - Search: "hot dog b" and "buns" find Hot dog buns; Hot dog buns suggests
//    Hot dog (regular).
//  - Every refusal: bad ids, missing par line or menu item, too long.
//  - Report: one restock to-do for the managers; the same line again (adds
//    to it, still one to-do); two registers at once (one report, one to-do);
//    a to-do missing from an older report is made on the next report.
//  - The to-do's Bought it (register and back office, twice, at once):
//    closes the report as bought, puts its items back on sale once, no
//    Undo, no Remove while it's open. Resolving the report (False alarm,
//    Found some, It's back + found) ticks the to-do off. "2nd time in 30
//    days" on a line that ran out again.
//  - It's back, Bought it with the item held by another report, a typed
//    (off-sheet) report, Back office → Menu's Clear, the register's poll,
//    the par count hint, the shopping list, Team → To-dos, History, and the
//    daily email's "Ran out today".
//  - "Raise par?": far-past reports (2001) on the switched-off line are
//    counted in their window, false alarms left out, and a switched-off
//    line is never flagged.
//
// Usage: node scripts/check-ran-out-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
// Reporting emails the purchasers (src/lib/ops/ran-out-alert.ts). Never
// from a check: with no key, sendEmail sends nothing.
delete process.env.RESEND_API_KEY;

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

const migrated =
  (await q("select count(*)::int as n from information_schema.columns where table_name = 'menu_items' and column_name in ('out_since', 'out_note', 'out_outage_id')"))[0].n === 3 &&
  (await q("select count(*)::int as n from information_schema.columns where table_name = 'staff_todos' and column_name in ('outage_id', 'audience')"))[0].n === 2;
if (!migrated) {
  console.log("The stock_outages (20260930030000) and restock_tasks (20260930050000) migrations aren't both applied yet. Apply them first.");
  await c.end();
  process.exit(1);
}

const TAG = "Ran-out check (delete me)";
// The person the check acts as: switched off, so the register never lists
// them (and, being switched off, is never recorded as who reported or
// bought something: that's checked too).
const [emp] = await q("insert into employees (name, pin_hash, role, active) values ($1, 'x', 'manager', false) returning id, name", [`${TAG} person`]);
const me = emp.id;
const session = JSON.stringify({ employeeId: emp.id, name: emp.name, role: "manager", email: "check@invalid" });
const stubs = {
  "server-only": "",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/server": "export function after(f) { return Promise.resolve().then(typeof f === 'function' ? f : () => f); }",
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
const outagesLib = await import("../src/lib/ops/outages.ts");
const { currentOuts } = outagesLib;
const search = await import("../src/lib/ops/ran-out-search.ts");
const shared = await import("../src/lib/ops/shared.ts");
const menuAdmin = await import("../src/app/admin/menu/actions.ts");
const teamActions = await import("../src/app/admin/team/actions.ts");
const team = await import("../src/lib/data/team.ts");

const made = { par: [], menu: [] };
const item = async (id) => (await q("select out_since, out_note, out_outage_id from menu_items where id = $1", [id]))[0];
const outage = async (id) => (await q("select * from stock_outages where id = $1", [id]))[0];
const todosFor = async (outageId) => q("select * from staff_todos where outage_id = $1", [outageId]);
const resolvedLogs = async (outageId) => (await q("select count(*)::int as n from ops_changes where entity = 'outage' and entity_id = $1 and action = 'resolved'", [outageId]))[0].n;

try {
  // ---------- pure: the to-do's words, ordinals, raise par ----------
  const ords = [[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [101, "101st"], [111, "111th"]];
  check("ordinals", ords.every(([n, w]) => shared.ordinal(n) === w), ords.map(([n]) => shared.ordinal(n)).join(" "));
  // Tue Sep 29 2026, 7:45 PM Central.
  const base = { what: "Hot dog buns", onSheet: true, source: "Walmart", sourceIsPerson: false, reportedAt: "2026-09-30T00:45:00Z", byName: "Caleb", parQty: 2, unit: "sleeves", unitSize: null, times: 1 };
  const t1text = shared.restockTaskText(base);
  check("to-do words: Buy … at the store", t1text.title === "Buy Hot dog buns at Walmart", t1text.title);
  check("to-do words: when, who, the par", t1text.details === "Ran out 7:45 PM Tue Sep 29, reported by Caleb. Par is 2 sleeves.", t1text.details);
  const t3text = shared.restockTaskText({ ...base, times: 3 });
  check("to-do words: 3rd time in 30 days, raise the par", t3text.details.endsWith("This is the 3rd time in 30 days: consider raising the par."), t3text.details);
  const typed = shared.restockTaskText({ ...base, what: "Napkins", onSheet: false, source: null, byName: null, parQty: null, unit: null, times: 2 });
  check("to-do words: not on the sheet, no store, nobody named", typed.title === "Buy Napkins" && typed.details === "Ran out 7:45 PM Tue Sep 29. This is the 2nd time in 30 days: consider adding it to the par sheet.", `${typed.title} | ${typed.details}`);
  const person = shared.restockTaskText({ ...base, what: "Popcorn kernels", source: "Andrew", sourceIsPerson: true, parQty: null, unit: "bags" });
  check("to-do words: a person who brings it, no par yet", person.title === "Get Popcorn kernels from Andrew" && person.details.endsWith("No par set yet."), `${person.title} | ${person.details}`);
  const sized = shared.restockTaskText({ ...base, parQty: 1, unit: "bags", unitSize: "12.5 lb" });
  check("to-do words: one unit, with its size", sized.details.endsWith("Par is 1 bag (12.5 lb)."), sized.details);
  const rp = shared.raiseParText({ name: "Hot dog buns", times: 3, days: 30, parQty: 2, unit: "sleeves", unitSize: null });
  check("raise par words", rp === "Hot dog buns ran out 3 times in 30 days. Raise par? It's 2 sleeves now.", rp);
  check("raise par words: no par yet", shared.raiseParText({ name: "Limes", times: 2, days: 30, parQty: null, unit: null, unitSize: null }).endsWith("Raise par? It has no par yet."));
  check("manager roles", ["manager", "admin", "owner"].every(shared.isManagerRole) && !["cashier", "display", null, undefined, ""].some(shared.isManagerRole));

  const line = (id, over = {}) => ({ name: `Line ${id}`, area: "Bar", par_qty: "2.00", unit: "sleeves", unit_size: null, active: true, updated_at: "2026-01-01T00:00:00Z", ...over });
  const summary = outagesLib.summarizeOftenOut([
    { par_item_id: "a", reported_at: "2026-09-01T00:00:00Z", item: line("a") },
    { par_item_id: "a", reported_at: "2026-09-20T00:00:00Z", item: line("a") },
    { par_item_id: "a", reported_at: "2026-09-10T00:00:00Z", item: line("a") },
    { par_item_id: "b", reported_at: "2026-09-10T00:00:00Z", item: line("b") }, // once: not flagged
    { par_item_id: "c", reported_at: "2026-09-10T00:00:00Z", item: line("c", { active: false }) },
    { par_item_id: "c", reported_at: "2026-09-11T00:00:00Z", item: line("c", { active: false }) }, // switched off
    { par_item_id: "d", reported_at: "2026-09-10T00:00:00Z", item: line("d", { updated_at: "2026-09-12T00:00:00Z" }) },
    { par_item_id: "d", reported_at: "2026-09-11T00:00:00Z", item: line("d", { updated_at: "2026-09-12T00:00:00Z" }) }, // edited since
    { par_item_id: "e", reported_at: "2026-09-10T00:00:00Z", item: line("e", { updated_at: "2026-09-10T12:00:00Z" }) },
    { par_item_id: "e", reported_at: "2026-09-11T00:00:00Z", item: line("e", { updated_at: "2026-09-10T12:00:00Z" }) }, // edited, then out again
  ]);
  check(
    "raise par: twice or more, switched-on lines, not edited since, most first",
    summary.length === 2 && summary[0].parItemId === "a" && summary[0].times === 3 && summary[0].lastAt === "2026-09-20T00:00:00Z" && summary[0].parQty === 2 && summary[1].parItemId === "e",
    summary.map((s) => `${s.parItemId}×${s.times}`).join(", "),
  );

  // ---------- the sheet's options (read only) ----------
  const opts = await ranOut.getRanOutOptions();
  const byName = (n) => opts.parItems.find((p) => p.name === n);
  const menuNamed = (n) => opts.menu.find((m) => m.name === n);
  const buns = byName("Hot dog buns");
  check("options: the par sheet is there", opts.parItems.length > 10 && !!buns, `${opts.parItems.length} lines`);
  const hotDog = menuNamed("Hot dog (regular)");
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
  const uses = (par) => (opts.recipeUses[byName(par)?.id] ?? []).map((id) => opts.menu.find((m) => m.id === id)?.name).sort();
  check("recipe link: Hot dog buns → Hot dog (regular)", JSON.stringify(uses("Hot dog buns")) === JSON.stringify(["Hot dog (regular)"]), uses("Hot dog buns").join(", "));
  check("recipe link: Hot dogs → Hot dog (regular)", JSON.stringify(uses("Hot dogs")) === JSON.stringify(["Hot dog (regular)"]));
  check("recipe link: Pizza crust → both pizzas", JSON.stringify(uses("Pizza crust")) === JSON.stringify(["Pizza (large)", "Pizza (slice)"]), uses("Pizza crust").join(", "));
  check("recipe link: Popcorn kernels → every popcorn", JSON.stringify(uses("Popcorn kernels")) === JSON.stringify(["Popcorn (large)", "Popcorn (personal)", "Popcorn (small)"]), uses("Popcorn kernels").join(", "));

  // Strong name matches on the real sheet and menu (what starts ticked).
  const strong = (par) => {
    const p = byName(par);
    return p ? search.strongMenuMatches(p.name, p.section, opts.menu).map((m) => m.name).sort() : null;
  };
  check("name match: Hot dog buns → Hot dog (regular)", JSON.stringify(strong("Hot dog buns")) === JSON.stringify(["Hot dog (regular)"]), String(strong("Hot dog buns")));
  check("name match: Hot dogs → Hot dog (regular)", JSON.stringify(strong("Hot dogs")) === JSON.stringify(["Hot dog (regular)"]));
  check("name match: Pizza crust → both pizzas", JSON.stringify(strong("Pizza crust")) === JSON.stringify(["Pizza (large)", "Pizza (slice)"]));
  check("name match: Popcorn kernels → every popcorn", strong("Popcorn kernels")?.length === 3 && strong("Popcorn kernels").every((n) => n.startsWith("Popcorn (")));
  const none = ["Pizza sauce", "Cheese", "Pepperoni", "Popping oil", "Flavacol"].filter((n) => byName(n));
  check("name match: sauce, cheese, oil and the like tick nothing", none.length > 0 && none.every((n) => strong(n).length === 0), none.map((n) => `${n}: ${strong(n).join("/") || "none"}`).join("; "));
  check("name match: typed \"hot dogs\" → Hot dog (regular), \"napkins\" → nothing", JSON.stringify(search.strongMenuMatches("hot dogs", null, opts.menu).map((m) => m.name)) === JSON.stringify(["Hot dog (regular)"]) && search.strongMenuMatches("napkins", null, opts.menu).length === 0);
  const fake = [
    { id: "1", name: "Hot dog (regular)", category: "x", outSince: null },
    { id: "2", name: "Chili cheese dog", category: "x", outSince: null },
    { id: "3", name: "Nachos", category: "x", outSince: null },
    { id: "4", name: "Large popcorn", category: "x", outSince: null },
  ];
  const f = (what, section = null) => search.strongMenuMatches(what, section, fake).map((m) => m.id).join(",");
  check(
    "name match: made-around parts only, section counts, typos forgiven",
    f("Hot dog buns") === "1" && f("Buns", "Hot dogs") === "1" && f("Nacho cheese") === "" && f("Nachos") === "3" && f("Popcorn kernels") === "4" && f("Popcorn bags") === "" && f("Hot dgo buns") === "",
    [f("Hot dog buns"), f("Buns", "Hot dogs"), f("Nacho cheese"), f("Nachos"), f("Popcorn kernels"), f("Popcorn bags")].join(" | "),
  );

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
  check("report: saved, with a to-do", r1.ok && r1.added && r1.todo === true, r1.ok ? r1.name : r1.error);
  const O1 = r1.outageId;
  const o1 = await outage(O1);
  check("report: row has the par line, its name, the note, no shift", o1.par_item_id === P1 && o1.label === "Ran-out check buns" && o1.note === "used the last sleeve" && o1.shift_id === null);
  check("report: a switched-off person isn't recorded as who reported it", o1.reported_by === null);
  const i1 = await item(M1);
  check("report: menu items 86'd with the reason", !!i1.out_since && i1.out_note === "Out of ran-out check buns" && i1.out_outage_id === O1, i1.out_note);
  check("report: logged for History", (await q("select count(*)::int as n from ops_changes where entity = 'outage' and entity_id = $1 and action = 'reported' and summary like 'Ran out of Ran-out check buns%'", [O1]))[0].n === 1);

  let [t1] = await todosFor(O1);
  check("to-do: one, for the managers, nobody in particular, open", !!t1 && t1.audience === "managers" && t1.assignee_id === null && t1.done_at === null && t1.created_by === null);
  check("to-do: Buy … at the store", t1?.title === "Buy Ran-out check buns at Check store", t1?.title);
  check("to-do: when and the par, no nudge the first time", /^Ran out \d{1,2}:\d{2} [AP]M \w{3} \w{3} \d{1,2}\. Par is 2 sleeves\.$/.test(t1?.details ?? ""), t1?.details);

  const poll = await currentOuts();
  const p1 = poll.outs.find((o) => o.itemId === M1);
  check("poll: the register sees the 86 and what ran out", !!p1 && p1.what === "Ran-out check buns" && p1.outageId === O1 && poll.open >= 1);
  const status = await ops.getShiftStatus();
  check("poll: getShiftStatus carries outs and the open count", status.outs.some((o) => o.itemId === M1) && status.ranOut >= 1);
  // The register never shows the restock to-do (no Bought it there): just
  // the quiet "Out of …" line. The purchasers are emailed instead.
  check("poll: the restock to-do stays off the register", !status.todos.some((t) => t.id === t1.id));
  check("poll: the quiet Out of line rides along", status.outNotices.some((n) => n.id === O1 && n.what === "Ran-out check buns"));
  const sheet = await ops.getParSheet();
  check("par count: the line shows it was reported out", !!sheet.outs[P1]);
  check("options: the line shows as already out", !!(await ranOut.getRanOutOptions()).open[P1]);

  // Same line again, one more item: added to the open report, still one to-do.
  const since1 = i1.out_since;
  const r2 = await ranOut.reportOutage({ parItemId: P1, label: null, note: "second sleeve too", menuItemIds: [M1, M3] }, me, null);
  check("again: adds to the open report", r2.ok && !r2.added && r2.outageId === O1 && r2.todo === true);
  const o1b = await outage(O1);
  check("again: stopped list and note merged", o1b.stopped_item_ids.length === 3 && o1b.note === "used the last sleeve / second sleeve too", o1b.note);
  check("again: an item already out keeps its time", String((await item(M1)).out_since) === String(since1));
  check("again: one open report per par line", (await q("select count(*)::int as n from stock_outages where par_item_id = $1 and resolved_at is null", [P1]))[0].n === 1);
  check("again: still one to-do", (await todosFor(O1)).length === 1);

  // A report from before to-dos (none made): the next report makes it.
  await q("delete from staff_todos where id = $1", [t1.id]);
  const r2b = await ranOut.reportOutage({ parItemId: P1, label: null, note: null, menuItemIds: [] }, me, null);
  [t1] = await todosFor(O1);
  check("again: a report missing its to-do gets one", r2b.ok && r2b.todo === true && !!t1 && (await todosFor(O1)).length === 1);

  // Two registers report the dogs at once: one report, one to-do.
  const [ra, rb] = await Promise.all([
    ranOut.reportOutage({ parItemId: P2, label: null, note: null, menuItemIds: [M1] }, me, null),
    ranOut.reportOutage({ parItemId: P2, label: null, note: null, menuItemIds: [M1] }, me, null),
  ]);
  const O2 = ra.ok ? ra.outageId : null;
  check("at once: both saved, the same report", ra.ok && rb.ok && ra.outageId === rb.outageId, ra.ok && rb.ok ? "" : (ra.error ?? rb.error));
  check("at once: one open report, one to-do", (await q("select count(*)::int as n from stock_outages where par_item_id = $1", [P2]))[0].n === 1 && (await todosFor(O2)).length === 1);
  check("second report: M1 now shows the newer reason", (await item(M1)).out_outage_id === O2 && (await item(M1)).out_note === "Out of ran-out check dogs");

  const open = await ranOut.getOpenOutages();
  const s1 = open.find((o) => o.id === O1);
  check("shopping list: both open, with par, unit, store", !!s1 && open.some((o) => o.id === O2) && s1.parQty === 2 && s1.unit === "sleeves" && s1.source === "Check store", s1 && `${s1.name} · ${s1.byName}`);
  check("shopping list: what each report still stops", JSON.stringify(s1?.stopped.sort()) === JSON.stringify(["Ran-out check dog 2 (delete me)", "Ran-out check dog 3 (delete me)"]), s1?.stopped.join(", "));

  // It's back on M2 (no resolution): only M2 clears.
  const b1 = await ranOut.markItemBack(M2, null, me);
  check("It's back: M2 back on sale, report and to-do still open", b1.ok && !(await item(M2)).out_since && !(await outage(O1)).resolved_at && (await todosFor(O1))[0].done_at === null);
  check("It's back: logged", (await q("select count(*)::int as n from ops_changes where entity = 'menu_item' and entity_id = $1 and action = 'restored'", [M2]))[0].n === 1);

  // Bought the dogs from the register's to-do: M1 is still out, for the buns.
  const [t2] = await todosFor(O2);
  const d2 = await ops.setTodoDone(t2.id, me);
  const m1 = await item(M1);
  check("Bought it (to-do): saved, says what it was", d2.ok && d2.restock?.what === "Ran-out check dogs" && d2.restock.back.length === 0, JSON.stringify(d2));
  check("Bought it (to-do): the report closed as bought", (await outage(O2)).resolution === "bought" && (await outage(O2)).resolved_by === null);
  check("Bought it (to-do): the to-do ticked off", (await todosFor(O2))[0].done_at !== null);
  check("Bought it (to-do): M1 stays out, back to the buns report", !!m1.out_since && m1.out_outage_id === O1 && m1.out_note === "Out of ran-out check buns", m1.out_note);
  const d2again = await ops.setTodoDone(t2.id, me);
  check("Bought it twice: fine, closed once", d2again.ok && (await resolvedLogs(O2)) === 1);
  const undo = await ops.undoTodoDone(t2.id);
  check("no Undo for a restock to-do", undo.ok === false && (await todosFor(O2))[0].done_at !== null, undo.ok ? "undone!" : undo.error);
  check("no Reopen from the back office either", (await teamActions.setTodoDoneFromOffice(t2.id, false)).ok === false);
  check("refused: a to-do id that isn't one", (await ops.setTodoDone("x", me)).ok === false && (await ops.undoTodoDone("x")).ok === false);

  const again = await ranOut.resolveOutage(O2, "found", me);
  check("resolving twice changes nothing", again.ok && (await outage(O2)).resolution === "bought");
  const badRes = await ranOut.resolveOutage(O1, "stolen", me);
  check("refused: a resolution that isn't one", badRes.ok === false);
  const badId = await ranOut.resolveOutage("x", "bought", me);
  check("refused: an outage id that isn't an id", badId.ok === false);

  // Remove isn't for an open restock to-do.
  const rm = await teamActions.deleteTodo(t1.id);
  check("Remove: refused while its report is open", rm.ok === false && (await todosFor(O1)).length === 1, rm.ok ? "removed!" : rm.error);

  // False alarm on the buns: M1 and M3 go back on sale, its to-do ticks off.
  const f1 = await ranOut.resolveOutage(O1, "mistake", me);
  check("False alarm: both items back on sale", f1.ok && f1.back.sort().join("|") === "Ran-out check dog 1 (delete me)|Ran-out check dog 3 (delete me)" && !(await item(M1)).out_since && !(await item(M3)).out_since, f1.ok ? f1.back.join(", ") : f1.error);
  check("False alarm: its to-do is ticked off", (await todosFor(O1))[0].done_at !== null);
  check("False alarm: off the shopping list and the par hint", !(await ranOut.getOpenOutages()).some((o) => o.id === O1) && !(await ops.getParSheet()).outs[P1]);

  // The dogs run out again: a new report, the "2nd time" nudge, and Bought
  // it from the register and the back office at the same moment.
  const r3 = await ranOut.reportOutage({ parItemId: P2, label: null, note: null, menuItemIds: [M3] }, me, null);
  const O3 = r3.ok ? r3.outageId : null;
  const [t3] = await todosFor(O3);
  check("out again: a new report and to-do", r3.ok && r3.added && O3 !== O2 && !!t3);
  check("out again: 2nd time in 30 days, consider raising the par", t3?.details.endsWith("This is the 2nd time in 30 days: consider raising the par."), t3?.details);
  const [x, y] = await Promise.all([ops.setTodoDone(t3.id, me), teamActions.setTodoDoneFromOffice(t3.id, true)]);
  check("Bought it on two screens at once: both fine", x.ok && y.ok, JSON.stringify([x, y]));
  check("…closed once, M3 back on sale, to-do done", (await resolvedLogs(O3)) === 1 && (await outage(O3)).resolution === "bought" && !(await item(M3)).out_since && (await todosFor(O3))[0].done_at !== null);

  // Something not on the par sheet, closed from the menu button: "Found some".
  const r4 = await ranOut.reportOutage({ parItemId: null, label: "  Ran-out   check limes ", note: null, menuItemIds: [M3] }, null, null);
  const O4 = r4.ok ? r4.outageId : null;
  check("typed: saved with the name tidied, nobody named", r4.ok && (await outage(O4)).label === "Ran-out check limes" && (await outage(O4)).reported_by === null && (await outage(O4)).par_item_id === null);
  const [t4] = await todosFor(O4);
  check("typed: to-do without a store or par", t4?.title === "Buy Ran-out check limes" && /^Ran out [^.]+\.$/.test(t4.details), `${t4?.title} | ${t4?.details}`);
  const b4 = await ranOut.markItemBack(M3, "found", me);
  check("It's back + found: item back and the report closed as found", b4.ok && !(await item(M3)).out_since && (await outage(O4)).resolution === "found");
  check("It's back + found: its to-do ticked off", (await todosFor(O4))[0].done_at !== null);

  // Back office → Menu: Clear.
  const r5 = await ranOut.reportOutage({ parItemId: null, label: "Ran-out check cups", note: null, menuItemIds: [M2] }, me, null);
  const cleared = await menuAdmin.clearItemOut(M2);
  check("Back office Clear: item back on sale, report and to-do stay", r5.ok && cleared.ok && !(await item(M2)).out_since && !(await outage(r5.outageId)).resolved_at && (await todosFor(r5.outageId))[0]?.done_at === null);
  const badClear = await menuAdmin.clearItemOut("nope");
  check("Back office Clear: refuses a bad id", badClear.ok === false);
  if (r5.ok) await ranOut.resolveOutage(r5.outageId, "mistake", me);

  // Team → To-dos: how each restock to-do closed.
  const todos = await team.getTodos();
  const closed = (id) => todos.find((t) => t.outageId === id);
  check(
    "Team → To-dos: for the managers, how each closed",
    closed(O2)?.forManagers && closed(O2)?.closedAs === "bought" && closed(O1)?.closedAs === "mistake" && closed(O4)?.closedAs === "found",
    [O2, O1, O4].map((id) => closed(id)?.closedAs).join(", "),
  );
  const rmDone = await teamActions.deleteTodo(closed(O4).id);
  check("Remove: fine once its report is closed", rmDone.ok && (await todosFor(O4)).length === 0);

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

  // ---------- "Raise par?" (far past, on the switched-off line) ----------
  const at = (iso) => q("insert into stock_outages (par_item_id, label, reported_at, resolved_at, resolution) values ($1, 'Ran-out check buns', $2, $2, $3)", [P1, iso, "bought"]);
  await at("2001-03-01T20:00:00Z");
  await at("2001-03-10T20:00:00Z");
  await at("2001-01-01T20:00:00Z"); // before the window
  await q("insert into stock_outages (par_item_id, label, reported_at, resolved_at, resolution) values ($1, 'Ran-out check buns', '2001-03-12T20:00:00Z', '2001-03-12T20:00:00Z', 'mistake')", [P1]);
  const window = await outagesLib.recentParOutages(new Date("2001-03-15T00:00:00Z"));
  const ours = window.filter((r) => r.par_item_id === P1);
  check("raise par: the 30 days before, false alarms left out", ours.length === 2 && ours.every((r) => r.item?.name === "Ran-out check buns"), `${ours.length} reports`);
  check("raise par: a switched-off line is never flagged", !(await outagesLib.getOftenOut(new Date("2001-03-15T00:00:00Z"))).some((o) => o.parItemId === P1));
  check("raise par: the managers' hint reads without error", Array.isArray(await ranOut.getRaiseParHints()));
} finally {
  const outages = (await q("select id from stock_outages where par_item_id = any($1) or label like 'Ran-out check%'", [made.par])).map((r) => r.id);
  await q("delete from staff_todos where outage_id = any($1)", [outages]);
  await q("delete from ops_changes where entity_id = any($1)", [[...outages, ...made.menu]]);
  await q("delete from stock_outages where id = any($1)", [outages]);
  await q("delete from menu_items where id = any($1)", [made.menu]);
  await q("delete from par_items where id = any($1)", [made.par]);
  await q("delete from rate_limit_hits where key = any($1)", [[`ran-out:${emp.id}`, `ran-out-fix:${emp.id}`]]).catch(() => {});
  await q("delete from employees where id = $1", [emp.id]);
  const left = (await q(
    `select (select count(*) from stock_outages where label like 'Ran-out check%')::int as o,
            (select count(*) from staff_todos where title like '%Ran-out check%')::int as t,
            (select count(*) from menu_items where name like 'Ran-out check%')::int as m,
            (select count(*) from par_items where name like 'Ran-out check%')::int as p,
            (select count(*) from employees where name like 'Ran-out check%')::int as e`,
  ))[0];
  console.log(`\nCleaned up: ${outages.length} reports and their to-dos, ${made.menu.length} menu items, ${made.par.length} par lines, 1 staff member. Left behind: ${left.o + left.t + left.m + left.p + left.e}.`);
  await c.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
