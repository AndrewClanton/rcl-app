// Pays the old-register (Fortis) cards that don't need a person to look:
// a high-confidence match (an email or phone on the payment, or the whole
// name on the card agreeing with exactly one member) whose member's
// past-purchase points stay at 1,000 or under. One grant per card, 1 point
// per $1 net, rounded down, through grant_fortis_card (migration
// 20261009120000), which checks every rule again and pays a card once,
// ever. Everything else is left for Back office's Needs approval.
//
// Prints counts only: never names or card digits.
//
// Usage: node scripts/grant-fortis-auto.mjs [--apply]
//   Dry run by default. --apply pays.
import { register } from "node:module";
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
const C = await import("../src/lib/fortis-claim.ts");

config({ path: ".env.local", quiet: true });
const APPLY = process.argv.includes("--apply");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function readAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const cards = await readAll(
  "fortis_cards",
  "id, match_status, match_kind, match_confidence, decision, matched_member_id, granted_at, erased_at, net_total",
);
const members = new Map((await readAll("members", "id, erased_at")).map((m) => [m.id, m]));
const already = new Map();
for (const g of await readAll("fortis_backfill_grants", "id, member_id, points")) already.set(g.member_id, (already.get(g.member_id) ?? 0) + Number(g.points));
const rejected = new Set((await readAll("fortis_card_rejections", "id, card_id, member_id")).map((r) => `${r.card_id}|${r.member_id}`));

// Smallest first, so a member with two cards gets the ones that fit.
const open = cards.filter((c) => !c.granted_at && !c.erased_at).sort((a, b) => Number(a.net_total) - Number(b.net_total) || (a.id < b.id ? -1 : 1));
const auto = [];
const running = new Map(already);
let erased = 0;
for (const c of open) {
  if (!C.highConfidence(c)) continue;
  if (rejected.has(`${c.id}|${c.matched_member_id}`)) continue;
  const m = members.get(c.matched_member_id);
  if (!m || m.erased_at) {
    erased++;
    continue;
  }
  const pts = C.pastPurchasePoints(Number(c.net_total));
  const before = running.get(c.matched_member_id) ?? 0;
  if (!C.withinLine(pts, before)) continue;
  running.set(c.matched_member_id, before + pts);
  auto.push({ id: c.id, member: c.matched_member_id, points: pts, dollars: Number(c.net_total) });
}

// What's left for a manager, as Back office will show it after this run.
const queue = open.filter((c) => !auto.some((a) => a.id === c.id)).map((c) => ({ c, why: C.queueReason(c, running.get(c.matched_member_id) ?? 0) }));
const waiting = queue.filter((q) => q.why);
const byWhy = {};
for (const q of waiting) {
  byWhy[q.why] ??= { cards: 0, points: 0 };
  byWhy[q.why].cards++;
  byWhy[q.why].points += C.pastPurchasePoints(Number(q.c.net_total));
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const autoPoints = sum(auto.map((a) => a.points));
const autoMembers = new Set(auto.map((a) => a.member)).size;
console.log(`Automatic (high confidence, 1,000 points or under per member): ${auto.length} cards, ${autoMembers} members, ${autoPoints.toLocaleString()} points ($${(autoPoints / 20).toFixed(2)} in rewards at 100 points = $5), from $${sum(auto.map((a) => a.dollars)).toFixed(2)} spent`);
console.log(`Needs approval: ${waiting.length} cards, ${sum(waiting.map((q) => C.pastPurchasePoints(Number(q.c.net_total)))).toLocaleString()} points`);
for (const [why, v] of Object.entries(byWhy)) console.log(`  ${C.QUEUE_REASON_TEXT[why]}: ${v.cards} cards, ${v.points.toLocaleString()} points`);
console.log(`Left alone: ${open.filter((c) => c.match_status === "unclaimed").length} unclaimed cards (claimable at the register or with Rewind), ${erased} matched to removed members`);

if (!APPLY) {
  console.log("\nDry run. Pass --apply to pay the automatic ones.");
  process.exit(0);
}

const tally = {};
let paid = 0;
const paidMembers = new Set();
for (const a of auto) {
  const { data, error } = await db.rpc("grant_fortis_card", { p_card: a.id, p_member: a.member, p_by: null, p_mode: "auto" });
  const status = error ? `error ${error.code}` : data.status;
  tally[status] = (tally[status] ?? 0) + 1;
  if (!error && data.status === "granted") {
    paid += Number(data.points);
    paidMembers.add(a.member);
  }
}
console.log("\nApplied:", tally);
console.log(`Paid ${paid.toLocaleString()} points to ${paidMembers.size} members ($${(paid / 20).toFixed(2)} in rewards).`);
