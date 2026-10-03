// Ran-out emails against the live database, through the real server code,
// with the send stubbed: every call to Resend is caught here and nothing is
// emailed to anyone. Throwaway rows (one switched-off staff member, two
// switched-off par lines, two par counts) are always deleted at the end, and
// the "Ran-out alerts go to" setting is put back exactly as it was.
//
//  - Reporting a par line emails each person in the setting once (their
//    sign-in email), with what ran out, when, who reported it, the par, this
//    week's counts and what was bought, the "raise the par from 1 quart"
//    suggestion, and a Back in stock link to Back office → Ran out.
//  - Repeated taps, the same line reported again, two at once, and the same
//    off-sheet words typed twice never send a second email.
//  - The register: no restock to-do, a quiet "Out of … · Nathan and Mary
//    have been emailed" line (names from the setting), gone once it's back
//    in stock in Back office.
//  - Nobody picked: no email, the report says so, and the claim is given
//    back. Owners/admins can't pick someone who's switched off.
//  - Back office → Ran out: open list, "Ran out this week" counts repeats.
//
// Usage: node scripts/check-ran-out-alert-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ---------- the send is stubbed: nothing reaches Resend ----------
process.env.RESEND_API_KEY = "re_check_stub_never_sent";
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.resend.com")) {
    const body = JSON.parse(init.body);
    sent.push({ to: body.to, subject: body.subject, html: body.html, text: body.text, key: init.headers["Idempotency-Key"] });
    return new Response(JSON.stringify({ id: `stub-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
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

const migrated = (await q("select count(*)::int as n from information_schema.columns where table_name = 'stock_outages' and column_name in ('alert_claimed_at', 'alert_sent_to')"))[0].n === 2;
if (!migrated) {
  console.log("The ran_out_alerts migration (20261002120000) isn't applied yet. Apply it first.");
  await c.end();
  process.exit(1);
}

const TAG = "Ran-out alert check";
const [emp] = await q("insert into employees (name, pin_hash, role, active) values ($1, 'x', 'manager', false) returning id, name", [`${TAG} Bryce (delete me)`]);
const session = JSON.stringify({ employeeId: emp.id, name: emp.name, role: "owner", email: "check@invalid" });
const stubs = {
  "server-only": "",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "@/lib/auth": `const s = ${session};
    export async function assertStaff() { return s; }
    export async function assertAdmin() { return s; }
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
const alert = await import("../src/lib/ops/ran-out-alert.ts");
const { currentOuts } = await import("../src/lib/ops/outages.ts");
const shared = await import("../src/lib/ops/shared.ts");
const board = await import("../src/lib/data/ran-out.ts");
const officeActions = await import("../src/app/admin/ran-out/actions.ts");

const [setting] = await q("select value from settings where key = 'ran_out_alert_to'");
const original = setting ? setting.value : null;
const made = { par: [], counts: [] };
const outage = async (id) => (await q("select * from stock_outages where id = $1", [id]))[0];

try {
  // ---------- pure words ----------
  check("names: two", shared.namesList(["Nathan", "Mary"]) === "Nathan and Mary");
  check("names: three", shared.namesList(["Nathan", "Mary", "Bryce"]) === "Nathan, Mary and Bryce");
  const line = shared.outNoticeText({ id: "x", what: "Heavy Whipping Cream", emailed: ["Nathan", "Mary"] });
  check("register line", line === "Out of Heavy Whipping Cream · Nathan and Mary have been emailed", line);
  check("register line: no email", shared.outNoticeText({ id: "x", what: "Limes", emailed: [] }).includes("didn't go out"));
  const sug = shared.ranOutSuggestion({ onSheet: true, parQty: 1, unit: "quarts", times: 1 });
  check("suggestion", sug === "Ran out before the week was over. Consider raising the par from 1 quart.", sug);
  check("suggestion: again", shared.ranOutSuggestion({ onSheet: true, parQty: 2, unit: "quarts", times: 3 }).endsWith("This is the 3rd time in 30 days."));

  // ---------- who the setting says ----------
  const ids = await alert.getAlertRecipientIds();
  const expected = await q(
    "select e.id, e.name, lower(u.email) as email from employees e join auth.users u on u.id = e.auth_user_id where e.id = any($1) and e.active and e.role <> 'display'",
    [ids],
  );
  const expectedEmails = expected.map((r) => r.email).sort();
  const expectedFirst = ids.map((id) => expected.find((r) => r.id === id)).filter(Boolean).map((r) => r.name.trim().split(/\s+/)[0]);
  check("setting: someone is picked, read from the database", ids.length > 0 && expected.length > 0, expectedFirst.join(", "));

  // ---------- throwaway par line, with this week's counts ----------
  const P1 = (await q("insert into par_items (area, section, name, par_qty, unit, source, sort_order, active) values ($1, null, $2, 1, 'quarts', 'Walmart', 99999, false) returning id", [TAG, `${TAG} cream`]))[0].id;
  const P2 = (await q("insert into par_items (area, section, name, par_qty, unit, source, sort_order, active) values ($1, null, $2, 1, 'quarts', 'Walmart', 99999, false) returning id", [TAG, `${TAG} limes`]))[0].id;
  made.par.push(P1, P2);
  // Two days ago it was empty, yesterday 2 quarts: bought 2 (this week, as
  // long as the check isn't run on a Monday or Tuesday).
  for (const [daysAgo, qty] of [[2, 0], [1, 2]]) {
    const cid = (await q("insert into par_counts (counted_by, completed_at) values ($1, now() - make_interval(days => $2)) returning id", [emp.id, daysAgo]))[0].id;
    made.counts.push(cid);
    await q("insert into par_count_lines (count_id, item_id, qty, par_qty) values ($1, $2, $3, 1)", [cid, P1, qty]);
  }

  // ---------- report it: one email per person in the setting ----------
  const r1 = await ranOut.reportOutage({ parItemId: P1, label: null, note: "used the last of it", menuItemIds: [] }, emp.id, null);
  check("report saved", r1.ok, r1.ok ? "" : r1.error);
  const O1 = r1.outageId;
  check("emailed the setting's people, first names", JSON.stringify(r1.emailed) === JSON.stringify(expectedFirst), r1.emailed.join(", "));
  const to1 = sent.flatMap((s) => s.to).map((e) => e.toLowerCase()).sort();
  check("one email to each recipient's sign-in address", JSON.stringify(to1) === JSON.stringify(expectedEmails), `${sent.length} caught, none sent`);
  const m = sent[0];
  // The check's staff member is switched off, so it isn't recorded as who
  // reported it (same as the register).
  check("subject", m?.subject === `Ran out: ${TAG} cream`, m?.subject);
  check("body: who reported, the par, the store", !!m && m.html.includes("Reported by") && m.html.includes("1 quart") && m.html.includes("Walmart"));
  check("body: this week's counts and what was bought", !!m && m.html.includes("Counted this week") && m.html.includes(": 2 quarts") && m.html.includes("+2 quarts (the count went up)"), m?.text.split("\n").filter((l) => /Counted|Bought/.test(l)).join(" | "));
  check("body: raise the par suggestion", !!m && m.html.includes("Ran out before the week was over. Consider raising the par from 1 quart."));
  check("body: Back in stock link to Back office → Ran out", !!m && m.html.includes(`/admin/ran-out?id=${O1}`) && m.text.includes(`/admin/ran-out?id=${O1}`));
  check("idempotency key per report and person", sent.every((s) => s.key?.startsWith(`ran-out-${O1}-`)));
  const o1 = await outage(O1);
  check("report remembers the claim and who it reached", !!o1.alert_claimed_at && o1.alert_sent_to.length === expected.length);

  // ---------- no spam ----------
  const before = sent.length;
  const r2 = await ranOut.reportOutage({ parItemId: P1, label: null, note: null, menuItemIds: [] }, emp.id, null);
  await Promise.all([alert.sendRanOutAlert(O1), alert.sendRanOutAlert(O1)]);
  check("same line again, and two at once: no second email", r2.ok && r2.outageId === O1 && sent.length === before && JSON.stringify(r2.emailed) === JSON.stringify(expectedFirst));
  const typedLabel = `${TAG} napkins`;
  const t1 = await ranOut.reportOutage({ parItemId: null, label: typedLabel, note: null, menuItemIds: [] }, emp.id, null);
  const afterFirstTyped = sent.length;
  const t2 = await ranOut.reportOutage({ parItemId: null, label: typedLabel, note: null, menuItemIds: [] }, emp.id, null);
  check("off-sheet item: emailed once, typed again sends nothing", t1.ok && t2.ok && afterFirstTyped === before + expected.length && sent.length === afterFirstTyped && t2.emailed.length === expected.length);
  check("off-sheet email suggests adding it to the par sheet", sent[before]?.html.includes("Consider adding it to the par sheet."));

  // ---------- the register ----------
  const status = await ops.getShiftStatus();
  const notice = status.outNotices.find((n) => n.id === O1);
  check("register: quiet Out of line with the setting's names", !!notice && shared.outNoticeText(notice) === `Out of ${TAG} cream · ${shared.namesList(expectedFirst)} ${expectedFirst.length === 1 ? "has" : "have"} been emailed`, notice && shared.outNoticeText(notice));
  const restockTodos = (await q("select id from staff_todos where outage_id = $1", [O1])).map((r) => r.id);
  check("register: no restock to-do (no Bought it)", restockTodos.length === 1 && !status.todos.some((t) => restockTodos.includes(t.id)));

  // ---------- Back office → Ran out ----------
  const open = await board.getOpenRanOuts();
  const b1 = open.find((o) => o.id === O1);
  check("back office: listed with who was emailed", !!b1 && JSON.stringify(b1.emailed) === JSON.stringify(expectedFirst) && b1.par === "1 quart");
  const wk = await board.getRanOutWeek();
  check("back office: ran out this week counts it", wk.lines.some((l) => l.key === P1 && l.times === 1 && l.stillOut));
  const back = await officeActions.closeRanOut(O1, "bought");
  check("back in stock: closes the report", back.ok && (await outage(O1)).resolution === "bought");
  check("back in stock: the register line goes away", !(await currentOuts()).notices.some((n) => n.id === O1));
  check("back in stock: restock to-do ticked off", (await q("select done_at from staff_todos where outage_id = $1", [O1]))[0]?.done_at !== null);

  // It runs out again the same week: a new report, a new email, counted twice.
  const r3 = await ranOut.reportOutage({ parItemId: P1, label: null, note: null, menuItemIds: [] }, emp.id, null);
  check("runs out again: a new report emails again", r3.ok && r3.outageId !== O1 && sent.length === afterFirstTyped + expected.length);
  check("runs out again: the email says it was bought after running out", sent.at(-1)?.html.includes("bought after it ran out") && sent.at(-1)?.html.includes("2nd time in 30 days"));
  check("back office: twice this week", (await board.getRanOutWeek()).lines.some((l) => l.key === P1 && l.times === 2));

  // ---------- nobody picked ----------
  const noPick = await officeActions.saveRanOutAlertTo([]);
  const quiet = sent.length;
  const r4 = await ranOut.reportOutage({ parItemId: P2, label: null, note: null, menuItemIds: [] }, emp.id, null);
  const o4 = await outage(r4.outageId);
  check("nobody picked: no email, says so, claim given back", noPick.ok && r4.ok && r4.emailed.length === 0 && sent.length === quiet && o4.alert_claimed_at === null);
  check("nobody picked: register line says no email went out", shared.outNoticeText((await currentOuts()).notices.find((n) => n.id === r4.outageId)).includes("didn't go out"));
  const refused = await officeActions.saveRanOutAlertTo([emp.id]);
  check("can't pick someone switched off", !refused.ok);
} finally {
  // The setting exactly as it was.
  if (original === null) await q("delete from settings where key = 'ran_out_alert_to'");
  else await q("update settings set value = $1 where key = 'ran_out_alert_to'", [JSON.stringify(original)]);
  const outages = (await q("select id from stock_outages where par_item_id = any($1) or label like $2", [made.par, `${TAG}%`])).map((r) => r.id);
  await q("delete from staff_todos where outage_id = any($1)", [outages]);
  await q("delete from ops_changes where entity_id = any($1)", [outages]);
  await q("delete from stock_outages where id = any($1)", [outages]);
  await q("delete from par_counts where id = any($1)", [made.counts]);
  await q("delete from par_items where id = any($1)", [made.par]);
  await q("delete from rate_limit_hits where key = any($1)", [[`ran-out:${emp.id}`, `ran-out-fix:${emp.id}`]]).catch(() => {});
  await q("delete from employees where id = $1", [emp.id]);
  const [now] = await q("select value from settings where key = 'ran_out_alert_to'");
  const left = (await q(
    `select (select count(*) from stock_outages where label like $1)::int + (select count(*) from par_items where name like $1)::int + (select count(*) from employees where name like $1)::int as n`,
    [`${TAG}%`],
  ))[0].n;
  console.log(`\nCleaned up: ${outages.length} reports, ${made.par.length} par lines, ${made.counts.length} counts, 1 staff member. Left behind: ${left}. Setting restored: ${JSON.stringify(now?.value ?? null) === JSON.stringify(original)}. Emails actually sent: 0 (${sent.length} caught by the stub).`);
  await c.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
