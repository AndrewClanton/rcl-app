// Loads Fortis's card-sales export into fortis_cards: one row per card
// (first six + last four digits, never more), with its approved sales less
// refunds, the business days it was used, and its match to a member (rules
// in src/lib/fortis-backfill.ts). Loading grants nothing: an owner or admin
// reviews the matches in Back office and presses Grant there.
//
// It also fills fortis_sales: one row per approved sale or refund (card
// key, business date, time, amount as charged; no names), keyed by Fortis's
// transaction id, which Rewind (src/lib/fortis-lookup.ts) searches by day
// and amount, and which counts as the member's past visits once their card
// is theirs. Re-loading updates rows in place, and takes out a sale the
// file now says was voided.
//
// The export stays where it is (it holds customers' names and card
// details); this only reads it. Prints counts, never names or card digits.
//
// Safe to re-run: cards are upserted by card, sales by Fortis's id. A
// card's totals are rebuilt from the file each time; a decision staff made
// by hand (approve, skip,
// pick) is kept, a granted card stays granted, and a card whose member's
// info was removed doesn't get its name back. A file that would shrink what's
// loaded (a partial export) is refused unless you pass --replace.
//
// Usage: node scripts/load-fortis-cards.mjs <fortis-export.csv> [--apply] [--replace]
//   Dry run by default (counts only). --apply writes.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

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
const L = await import("../src/lib/fortis-backfill.ts");
const LK = await import("../src/lib/fortis-lookup.ts");

config({ path: ".env.local", quiet: true });
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const REPLACE = args.includes("--replace");
if (!file) {
  console.error("Usage: node scripts/load-fortis-cards.mjs <fortis-export.csv> [--apply] [--replace]");
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

// ---- Read and add up the export ---------------------------------------------
const [header, ...raw] = L.parseCsv(readFileSync(file, "utf8"));
const COLUMNS = {
  id: "id",
  statusId: "status id",
  typeId: "type id",
  firstSix: "first six",
  lastFour: "last four",
  holderName: "account holder name",
  amount: "transaction amount",
  subtotal: "subtotal amount",
  createdTs: "created ts",
  email: "notification email address",
  phone: "notification phone",
  brand: "account type",
};
const at = {};
for (const [k, name] of Object.entries(COLUMNS)) {
  at[k] = header.findIndex((h) => h.trim().toLowerCase() === name);
  if (at[k] < 0) {
    console.error(`The export has no "${name}" column. Is this Fortis's transaction export?`);
    process.exit(1);
  }
}
const rows = raw.filter((r) => r.length > 1).map((r) => Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, r[at[k]] ?? ""])));
const { cards, stats } = L.aggregateFortisRows(rows);
console.log(`${stats.rows} rows: ${stats.sales} approved sales ($${stats.salesDollars.toFixed(2)}), ${stats.refunds} refunds ($${stats.refundDollars.toFixed(2)}),`);
console.log(`  left out: ${stats.voided} voided, ${stats.declined} declined, ${stats.other} other, ${stats.noCard} without a card number, ${stats.badDate} with an unreadable date`);
console.log(`${cards.length} cards with an approved sale; ${cards.filter((c) => c.nameKeys.length).length} carry a usable name, ${cards.filter((c) => c.email).length} an email, ${cards.filter((c) => c.phone).length} a phone`);

// ---- What's loaded already -----------------------------------------------------
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
async function readAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
let existingRows;
try {
  existingRows = await readAll(
    "fortis_cards",
    "id, card_key, sale_count, decision, match_status, match_kind, match_confidence, matched_member_id, candidate_member_ids, matched_at, granted_at, erased_at",
  );
} catch (e) {
  console.error(`Couldn't read fortis_cards (${e.message}). Apply supabase/migrations/20261001180000_fortis_backfill.sql first.`);
  process.exit(1);
}
const existing = new Map(existingRows.map((r) => [r.card_key, r]));

// Rewind's per-purchase rows, and what's in fortis_sales now.
const saleRows = LK.fortisSaleRows(rows);
let loadedSales;
try {
  loadedSales = new Map((await readAll("fortis_sales", "id, fortis_id, card_key, business_date, amount_cents, created_at, kind")).map((r) => [r.fortis_id, r]));
} catch (e) {
  console.error(`Couldn't read fortis_sales (${e.message}). Apply supabase/migrations/20261001190000_fortis_lookup.sql first.`);
  process.exit(1);
}
const sameSale = (a, b) =>
  a.card_key === b.cardKey && a.business_date === b.businessDate && a.amount_cents === b.amountCents && a.kind === b.kind && Date.parse(a.created_at) === Date.parse(b.createdAt);
const salesToWrite = saleRows.sales.filter((s) => !loadedSales.has(s.fortisId) || !sameSale(loadedSales.get(s.fortisId), s));
const salesToRemove = saleRows.gone.filter((id) => loadedSales.has(id));

// A partial export (a date range, a 5,000-row cap) would quietly shrink cards.
const inFile = new Map(cards.map((c) => [c.cardKey, c]));
const missing = existingRows.filter((r) => !inFile.has(r.card_key)).length;
const shrinking = existingRows.filter((r) => inFile.has(r.card_key) && inFile.get(r.card_key).saleCount < r.sale_count).length;
if ((missing || shrinking) && !REPLACE) {
  console.error(`This file has less than what's loaded: ${missing} loaded cards aren't in it, ${shrinking} would lose sales.`);
  console.error("Is it a partial export? Load the all-time export, or pass --replace to load it anyway.");
  process.exit(1);
}

// ---- Match -------------------------------------------------------------------
const members = (await readAll("members", "id, name, email, phone_digits, erased_at")).map((m) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  phoneDigits: m.phone_digits,
  erased: !!m.erased_at,
}));
const memberIds = new Set(members.filter((m) => !m.erased).map((m) => m.id));
const idx = L.buildMemberIndex(members);
const now = new Date().toISOString();

const matched = [];
const kept = [];
const finalState = [];
for (const c of cards) {
  const prev = existing.get(c.cardKey);
  const erased = !!prev?.erased_at;
  const base = {
    card_key: c.cardKey,
    brand: c.brand,
    holder_name: erased ? null : c.holderName,
    name_keys: erased ? [] : c.nameKeys,
    name_fulls: erased ? [] : c.nameFulls,
    contact_email: erased ? null : c.email,
    contact_phone: erased ? null : c.phone,
    sale_count: c.saleCount,
    refund_count: c.refundCount,
    sales_total: c.salesTotal,
    refunds_total: c.refundsTotal,
    first_purchase_at: c.firstAt,
    last_purchase_at: c.lastAt,
    visit_dates: c.visitDates,
    loaded_at: now,
  };
  // A decision that points at a member who's gone (deleted) is re-matched.
  const state = prev && prev.matched_member_id && !memberIds.has(prev.matched_member_id) && !prev.granted_at ? { ...prev, matched_member_id: null } : prev;
  if (!state || L.shouldRematch(state)) {
    const m = L.matchCard(c, idx);
    const cols = L.matchColumns(m, now, state && L.sameMatch(state, m) ? state.matched_at : null);
    matched.push({ ...base, ...cols });
    finalState.push({ card: c, ...cols, granted_at: null });
  } else {
    kept.push(base);
    finalState.push({ card: c, ...state });
  }
}

// ---- Counts ------------------------------------------------------------------
const tally = {};
const dollars = {};
for (const s of finalState) {
  const k = `${s.match_status}${s.match_kind ? ` / ${s.match_kind}` : ""}${s.match_confidence ? ` / ${s.match_confidence}` : ""}`;
  tally[k] = (tally[k] ?? 0) + 1;
  dollars[s.match_status] = (dollars[s.match_status] ?? 0) + s.card.salesTotal - s.card.refundsTotal;
}
console.log(`\n${cards.length - existingRows.filter((r) => inFile.has(r.card_key)).length} new cards, ${kept.length} keep a decision made by hand or a grant`);
console.log("matches:", tally);
console.log("dollars:", Object.fromEntries(Object.entries(dollars).map(([k, v]) => [k, Number(v.toFixed(2))])));
const planCards = finalState
  .filter((s) => s.matched_member_id && s.decision !== "skipped" && !s.granted_at)
  .map((s) => ({ id: s.card.cardKey, memberId: s.matched_member_id, dollars: s.card.salesTotal - s.card.refundsTotal }));
const plan = L.planGrant(planCards, L.DEFAULT_GRANT_SETTINGS);
const t = L.planTotals(plan);
console.log(`If every match were approved, at 1 point per $1 before tax: ${t.points} points to ${t.members} members ($${t.dollars.toFixed(2)})`);
console.log(`  top 10: ${plan.slice(0, 10).map((p) => p.points).join(", ")}; 300+: ${plan.filter((p) => p.points >= 300).length}; 500+: ${plan.filter((p) => p.points >= 500).length}`);

console.log(
  `\nfortis_sales: ${saleRows.sales.length} in the file (${saleRows.sales.filter((s) => s.kind === "sale").length} sales, ${saleRows.sales.filter((s) => s.kind === "refund").length} refunds; ${saleRows.skipped} left out); ` +
    `${loadedSales.size} loaded now, ${salesToWrite.filter((s) => !loadedSales.has(s.fortisId)).length} new, ${salesToWrite.filter((s) => loadedSales.has(s.fortisId)).length} changed, ${salesToRemove.length} to take out (voided since)`,
);

if (!APPLY) {
  console.log("\nDry run: nothing written. Pass --apply to load.");
  process.exit(0);
}

// ---- Write -------------------------------------------------------------------
let written = 0;
for (const batch of [matched, kept]) {
  for (let i = 0; i < batch.length; i += 500) {
    const { error } = await supabase.from("fortis_cards").upsert(batch.slice(i, i + 500), { onConflict: "card_key" });
    if (error) {
      console.error(`Stopped after ${written} cards: ${error.message}. Run it again to finish (it's safe).`);
      process.exit(1);
    }
    written += Math.min(500, batch.length - i);
  }
}
// ---- Sales, for Rewind -----------------------------------------------------------
const loadedAt = new Date().toISOString();
let salesWritten = 0;
for (let i = 0; i < salesToWrite.length; i += 500) {
  const batch = salesToWrite.slice(i, i + 500).map((s) => ({
    fortis_id: s.fortisId,
    card_key: s.cardKey,
    business_date: s.businessDate,
    amount_cents: s.amountCents,
    created_at: s.createdAt,
    kind: s.kind,
    loaded_at: loadedAt,
  }));
  const { error } = await supabase.from("fortis_sales").upsert(batch, { onConflict: "fortis_id" });
  if (error) {
    console.error(`Loaded ${written} cards, then stopped after ${salesWritten} sales: ${error.message}. Run it again to finish (it's safe).`);
    process.exit(1);
  }
  salesWritten += batch.length;
}
for (let i = 0; i < salesToRemove.length; i += 200) {
  const { error } = await supabase.from("fortis_sales").delete().in("fortis_id", salesToRemove.slice(i, i + 200));
  if (error) {
    console.error(`Couldn't take out voided sales: ${error.message}. Run it again to finish (it's safe).`);
    process.exit(1);
  }
}
console.log(`\nLoaded ${written} cards and ${salesWritten} new or changed sales (${salesToRemove.length} taken out). Nothing was granted.`);
