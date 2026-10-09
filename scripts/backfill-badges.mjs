// The Badge Case backfill (supabase/migrations/20261009030000_badge_case.sql):
//  1. The issuer's public key, from BADGE_SIGNING_KEY (set once; a
//     different key later is refused).
//  2. The eleven badges from lib/visits.ts as Series 1 definitions, with
//     their gen-1 art (lib/badges/art.ts SERIES1_ART) and rules.
//  3. A holder for every member with a badge.
//  4. A signed copy for every earned badge (member_badges), serials in the
//     order they were earned.
// Safe to run again: anything already done is skipped.
//
// Usage: node scripts/backfill-badges.mjs            (dry run: counts only)
//        node scripts/backfill-badges.mjs --apply
import { register } from "node:module";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        if (s.startsWith("@/")) return next(${JSON.stringify(srcRoot)} + s.slice(2) + ".ts", c);
        if (s.startsWith(".") && c.parentURL?.endsWith(".ts") && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c);
        return next(s, c);
      }`,
    ),
);

const apply = process.argv.includes("--apply");
const { BADGES } = await import("../src/lib/visits.ts");
const { SERIES1_ART, GENERATOR } = await import("../src/lib/badges/art.ts");
const { SERIES1_RULES } = await import("../src/lib/badges/rules.ts");
const { publicKeyFor } = await import("../src/lib/badges/cert.ts");
const server = await import("../src/lib/badges/server.ts");
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");

const key = process.env.BADGE_SIGNING_KEY;
if (!key) {
  console.error("BADGE_SIGNING_KEY isn't in .env.local");
  process.exit(1);
}
const db = createAdminClient();
const must = (r, what) => {
  if (r.error) {
    console.error(`${what}: ${r.error.message}`);
    process.exit(1);
  }
  return r.data;
};

console.log(apply ? "APPLYING" : "DRY RUN (add --apply to write)");

// 1. issuer
const issuer = must(await db.from("badge_issuers").select("id, name, public_key").eq("slug", "rcl").single(), "issuer");
const pub = publicKeyFor(key);
if (issuer.public_key && issuer.public_key !== pub) {
  console.error("badge_issuers already has a different public key: BADGE_SIGNING_KEY doesn't match. Stopping.");
  process.exit(1);
}
console.log(`Issuer ${issuer.name}: public key ${issuer.public_key ? "already set" : "to set"}`);
if (apply && !issuer.public_key) must(await db.from("badge_issuers").update({ public_key: pub }).eq("id", issuer.id), "issuer key");

// 2. definitions
const series = must(await db.from("badge_series").select("id").eq("issuer_id", issuer.id).eq("number", 1).single(), "series");
const have = new Set(must(await db.from("badge_defs").select("key"), "defs").map((d) => d.key));
const newDefs = BADGES.map((b, i) => ({
  issuer_id: issuer.id,
  series_id: series.id,
  key: b.key,
  name: b.label,
  flavor: SERIES1_ART[b.key].line,
  set_number: i + 1,
  rule_type: SERIES1_RULES[b.key].ruleType,
  rule_params: SERIES1_RULES[b.key].params,
  period: SERIES1_RULES[b.key].period,
  points: b.points,
  reward: b.reward ?? null,
  cheer: b.cheer,
  form_label: SERIES1_ART[b.key].form,
  parts_spec: SERIES1_ART[b.key].spec,
  generator: GENERATOR,
})).filter((d) => !have.has(d.key));
console.log(`Series 1 definitions: ${BADGES.length - newDefs.length} there, ${newDefs.length} to add${newDefs.length ? ` (${newDefs.map((d) => `#${d.set_number} ${d.name}`).join(", ")})` : ""}`);
if (apply && newDefs.length) must(await db.from("badge_defs").insert(newDefs), "insert defs");

// 3 and 4. holders and copies
const claims = [];
for (let from = 0; ; from += 1000) {
  const page = must(await db.from("member_badges").select("id, member_id, badge, period, visit_id, earned_at").order("earned_at").order("id").range(from, from + 999), "claims");
  claims.push(...page);
  if (page.length < 1000) break;
}
const copies = must(await db.from("badge_copies").select("source_ref, signature"), "copies");
const signed = new Set(copies.filter((c) => c.signature).map((c) => c.source_ref));
const todo = claims.filter((c) => !signed.has(`member_badges:${c.id}`));
const memberIds = [...new Set(claims.map((c) => c.member_id))];
const withHolder = new Set();
for (let i = 0; i < memberIds.length; i += 200) {
  const rows = must(await db.from("members").select("id, badge_holder_id").in("id", memberIds.slice(i, i + 200)), "members");
  for (const r of rows) if (r.badge_holder_id) withHolder.add(r.id);
}
console.log(`Members with badges: ${memberIds.length} (${withHolder.size} have a holder, ${memberIds.length - withHolder.size} to make)`);
const byBadge = {};
for (const c of todo) byBadge[c.badge] = (byBadge[c.badge] ?? 0) + 1;
console.log(`Earned badges: ${claims.length}; copies signed already ${claims.length - todo.length}; to mint ${todo.length}`);
for (const [k, n] of Object.entries(byBadge)) console.log(`  ${k.padEnd(12)} ${n}`);

if (!apply) process.exit(0);

server.forgetCatalog();
const holders = new Map();
let minted = 0;
let holdersMade = 0;
const factsCache = new Map();
for (const c of todo) {
  let h = holders.get(c.member_id);
  if (!h) {
    if (!withHolder.has(c.member_id)) holdersMade++;
    h = await server.holderFor(c.member_id, db);
    if (!h) {
      console.error(`no holder for member ${c.member_id}; skipped`);
      continue;
    }
    holders.set(c.member_id, h);
  }
  if (!factsCache.has(c.member_id)) {
    const mine = claims.filter((x) => x.member_id === c.member_id);
    factsCache.set(c.member_id, await server.claimFacts(db, c.member_id, mine));
  }
  const out = await server.mintClaims(h, [{ claimId: c.id, key: c.badge, period: c.period ?? "", facts: factsCache.get(c.member_id).get(c.id) ?? null, mintedAt: c.earned_at }], db);
  minted += out.length;
}
console.log(`Done: ${holdersMade} holders made, ${minted} copies minted and signed.`);
process.exit(0);
