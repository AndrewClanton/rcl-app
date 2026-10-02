// Seeds legacy_billing_payers (20261002040000) with the former unlimited
// members the old card processor (Fortis) actually charged in September
// 2026, so "Press play" (Back office -> Email -> Ready to send) leaves them
// out.
//
// Reads the private match file (one row per recurring schedule, written
// into the imports folder, never the repo) and inserts member ids, the
// last approved charge date and a fixed note. Nothing else: no names, no
// card details. Prints counts only.
//
// Usage (from the main checkout, which has .env.local):
//   node scripts/seed-legacy-billing-payers.mjs [match.csv]          # dry run
//   node scripts/seed-legacy-billing-payers.mjs [match.csv] --apply
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "../imports/fortis-recurring-members-2026-10-02.csv";
const NOTE = "Charged on the old system (Fortis recurring) in September 2026";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCsv(text) {
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const [head, ...body] = parseCsv(readFileSync(FILE, "utf8"));
const col = (n) => {
  const i = head.indexOf(n);
  if (i < 0) throw new Error(`The match file has no "${n}" column.`);
  return i;
};
const I = { sept: col("sept 2026 result"), member: col("matched member id"), conf: col("match confidence"), paid: col("last approved charge") };

const payers = new Map();
let approved = 0;
for (const r of body) {
  if (r.length < head.length) continue;
  if (r[I.sept] !== "approved") continue;
  approved++;
  const id = r[I.member].trim().toLowerCase();
  if (!UUID.test(id) || r[I.conf] === "no match") continue;
  if (!DATE.test(r[I.paid])) throw new Error("A September payer has no last approved charge date.");
  payers.set(id, r[I.paid]);
}
console.log(`September 2026 approved schedules: ${approved}; matched to a member: ${payers.size}`);

const client = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const ids = [...payers.keys()];
  const { rows } = await client.query("select id, legacy_plus from members where id = any($1::uuid[]) and erased_at is null", [ids]);
  console.log(`Live member accounts: ${rows.length} of ${ids.length}; former unlimited (legacy_plus): ${rows.filter((m) => m.legacy_plus).length}`);
  if (rows.length !== ids.length) throw new Error("A matched member id isn't a live account. Nothing was written.");
  if (!APPLY) {
    console.log("Dry run. Add --apply to write them.");
  } else {
    await client.query("begin");
    let n = 0;
    for (const [id, paid] of payers) {
      const res = await client.query(
        `insert into legacy_billing_payers (member_id, last_paid_on, note) values ($1, $2, $3)
         on conflict (member_id) do update set last_paid_on = greatest(legacy_billing_payers.last_paid_on, excluded.last_paid_on), note = excluded.note`,
        [id, paid, NOTE],
      );
      n += res.rowCount;
    }
    await client.query("commit");
    const total = await client.query("select count(*)::int n from legacy_billing_payers");
    console.log(`Written: ${n}. legacy_billing_payers now has ${total.rows[0].n}.`);
  }
} catch (e) {
  await client.query("rollback").catch(() => {});
  throw e;
} finally {
  await client.end();
}
