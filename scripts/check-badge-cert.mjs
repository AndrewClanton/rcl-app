// Checks the Badge Case (src/lib/badges/):
//  1. Certificates: a sample copy signed with a fresh Ed25519 key verifies;
//     the same fields in another key order give the same bytes; changing
//     the serial, the holder, the stats or the art hash breaks it; another
//     key doesn't verify it.
//  2. The rules: the data-driven Series 1 rules (lib/badges/rules.ts) pick
//     exactly the badges lib/visits.ts badgesFor did, over thousands of
//     made-up visits (times of day, visit numbers, streaks, birthdays).
//  3. The art: every Series 1 recipe draws, and cleanSpec keeps it as is.
//  4. With --db: every signed copy in the database verifies against its
//     issuer's public key and its stored art, serials run 1..N per badge,
//     and the catalog's rules match the built-in list.
//
// Usage: node scripts/check-badge-cert.mjs [--db]
import { register } from "node:module";
import { generateKeyPairSync, createHash } from "node:crypto";
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

const cert = await import("../src/lib/badges/cert.ts");
const rules = await import("../src/lib/badges/rules.ts");
const art = await import("../src/lib/badges/art.ts");
const visits = await import("../src/lib/visits.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ---------- 1. certificates ----------
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const priv = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const svg = art.renderArt(art.SERIES1_ART.night_owl.spec);
const sample = {
  copyId: "8f0d7c2e-1b2a-4f5e-9a1b-0c2d3e4f5a6b",
  defId: "11111111-2222-4333-8444-555555555555",
  series: 1,
  serial: 12,
  holderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  issuerId: "99999999-8888-4777-8666-555555555555",
  mintedAt: "2026-10-09T04:12:33.123+00:00",
  artHash: cert.artHash(svg),
  name: "Night Owl",
  flavor: "Checked in at 11 PM or later.",
  stats: { visits: 7, weeks: 3, time: "11:42 PM" },
  event: { kind: null, ref: null, label: null },
};
const sig = cert.signCert(sample, priv);
check("a signed sample verifies", cert.verifyCert(sample, sig, pub));
check("the public key comes from the private one", cert.publicKeyFor(priv) === pub);
check("the art hash is sha256 of the SVG", sample.artHash === createHash("sha256").update(svg).digest("hex"));
const reordered = { ...sample, stats: { time: "11:42 PM", weeks: 3, visits: 7 } };
check("stats in another key order: same certificate", cert.certPayload(reordered) === cert.certPayload(sample) && cert.verifyCert(reordered, sig, pub));
check("the mint time in another form: same certificate", cert.verifyCert({ ...sample, mintedAt: "2026-10-09T04:12:33.123Z" }, sig, pub));
for (const [what, change] of [
  ["serial", { serial: 13 }],
  ["holder", { holderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef" }],
  ["stats", { stats: { ...sample.stats, visits: 8 } }],
  ["art hash", { artHash: cert.artHash(svg + " ") }],
  ["name", { name: "Night 0wl" }],
  ["event", { event: { kind: "screening", ref: "x", label: "Midnight show" } }],
]) check(`a changed ${what} fails`, !cert.verifyCert({ ...sample, ...change }, sig, pub));
const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
check("another issuer's key doesn't verify it", !cert.verifyCert(sample, sig, other));
check("a broken signature doesn't verify", !cert.verifyCert(sample, "AAAA", pub));
console.log(`      sample certificate: ${cert.certPayload(sample).slice(0, 120)}…`);

// ---------- 2. the rules ----------
const keyOf = (claims) => JSON.stringify(claims.map((c) => [c.key, c.period]));
let mismatches = 0;
let tried = 0;
const birthdays = [null, "2000-10-09", "2000-12-30", "2000-01-01", "2000-02-29", "2000-07-04"];
const start = Date.parse("2026-01-01T00:00:00Z");
for (let i = 0; i < 6000; i++) {
  const at = new Date(start + ((i * 7919 * 60_000) % (380 * 86_400_000)));
  const f = { at, visitNumber: (i * 37) % 130, weekStreak: (i * 13) % 60, birthday: birthdays[i % birthdays.length] };
  tried++;
  const want = visits.badgesFor(f);
  const got = rules.claimsFor(rules.FALLBACK_DEFS, f);
  if (keyOf(want) !== keyOf(got)) {
    if (mismatches < 3) console.log(`      mismatch at ${at.toISOString()}: ${keyOf(want)} vs ${keyOf(got)}`);
    mismatches++;
  }
}
check(`Series 1 rules pick the same badges as before (${tried} visits)`, mismatches === 0, mismatches ? `${mismatches} differ` : "");
check("points and rewards carried over", rules.FALLBACK_DEFS.every((d) => {
  const b = visits.badgeFor(d.key);
  return b && b.points === d.points && (b.reward ?? null) === d.reward;
}));
check("manual and event badges never come from a check-in", rules.ruleMatches({ ...rules.FALLBACK_DEFS[0], ruleType: "manual" }, { at: new Date(), visitNumber: 5, weekStreak: 5, birthday: null }) === null && rules.ruleMatches({ ...rules.FALLBACK_DEFS[0], ruleType: "event" }, { at: new Date(), visitNumber: 5, weekStreak: 5, birthday: null }) === null);

// ---------- 3. the art ----------
for (const [key, a] of Object.entries(art.SERIES1_ART)) {
  const drawn = art.renderArt(a.spec);
  const clean = art.cleanSpec(JSON.parse(JSON.stringify(a.spec)));
  if (!drawn.startsWith("<svg") || !clean || art.renderArt(clean) !== drawn) check(`art: ${key}`, false, "doesn't draw the same after cleanSpec");
}
check("every Series 1 recipe draws and survives cleanSpec", true);
check("cleanSpec refuses an unknown part", art.cleanSpec({ form: ["pin", { fill: "#000000", edge: "#ffffff" }], parts: [["script"]] }) === null);
check("cleanSpec refuses markup in a name plate", art.cleanSpec({ form: ["pin", { fill: "#000000", edge: "#ffffff" }], parts: [["plate", { t: "<b>x" }]] }) === null);
check("cleanSpec drops a non-color fill", art.cleanSpec({ form: ["button", { fill: "red;" }] }) === null);

// ---------- 4. the database ----------
if (process.argv.includes("--db")) {
  const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
  const db = createAdminClient();
  const { data: issuers } = await db.from("badge_issuers").select("id, public_key");
  const keys = new Map((issuers ?? []).map((i) => [i.id, i.public_key]));
  const { data: copies, error } = await db
    .from("badge_copies")
    .select("id, def_id, issuer_id, series, serial, holder_id, minted_at, name, flavor, stats, event_kind, event_ref, event_label, art_svg, art_hash, signature")
    .not("signature", "is", null)
    .order("serial");
  if (error) check("read badge_copies", false, error.message);
  let bad = 0;
  const serials = new Map();
  for (const c of copies ?? []) {
    const fields = {
      copyId: c.id, defId: c.def_id, series: c.series, serial: c.serial, holderId: c.holder_id, issuerId: c.issuer_id, mintedAt: c.minted_at,
      artHash: c.art_hash, name: c.name, flavor: c.flavor, stats: c.stats, event: { kind: c.event_kind, ref: c.event_ref, label: c.event_label },
    };
    if (cert.artHash(c.art_svg) !== c.art_hash || !cert.verifyCert(fields, c.signature, keys.get(c.issuer_id))) bad++;
    serials.set(c.def_id, [...(serials.get(c.def_id) ?? []), c.serial]);
  }
  check(`every signed copy verifies (${copies?.length ?? 0})`, bad === 0, bad ? `${bad} don't` : "");
  check("serials run 1..N per badge", [...serials.values()].every((s) => s.every((n, i) => n === i + 1)));
  const { data: defs } = await db.from("badge_defs").select("key, rule_type, rule_params, period, points, reward");
  const drift = rules.FALLBACK_DEFS.filter((f) => {
    const d = (defs ?? []).find((x) => x.key === f.key);
    return !d || d.rule_type !== f.ruleType || JSON.stringify(d.rule_params) !== JSON.stringify(f.params) || d.period !== f.period || d.points !== f.points || (d.reward ?? null) !== f.reward;
  });
  check("the catalog's Series 1 rules match the built-in list", drift.length === 0, drift.map((d) => d.key).join(", "));
}

console.log(failures ? `\n${failures} FAILED` : "\nAll passed.");
process.exit(failures ? 1 : 0);
