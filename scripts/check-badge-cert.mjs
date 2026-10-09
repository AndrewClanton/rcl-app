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
//     issuer's public key and its stored art (and any pre-transfer
//     signature for its old holder), serials never repeat or reuse a
//     retired one, voids keep a reason, the catalog's rules match the
//     built-in list, and a rehearsal of the permanence rule (no deletes,
//     transfer and re-sign, void, the 10-minute undo, erasure) runs in a
//     transaction that's rolled back.
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
// A transfer (a merge): the certificate covers the holder, so the copy is
// re-signed for its new one; the old signature, kept in its history, still
// verifies for the old holder. A void doesn't touch the certificate.
const moved = { ...sample, holderId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" };
const resigned = cert.signCert(moved, priv);
check("transfer: the old signature doesn't cover the new holder", !cert.verifyCert(moved, sig, pub));
check("transfer: re-signed for the new holder, same serial and mint data", cert.verifyCert(moved, resigned, pub) && moved.serial === sample.serial && moved.mintedAt === sample.mintedAt);
check("transfer: the kept original still verifies for the old holder", cert.verifyCert(sample, sig, pub));

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
    .select("id, def_id, issuer_id, series, serial, holder_id, minted_at, name, flavor, stats, event_kind, event_ref, event_label, art_svg, art_hash, signature, history, resign_pending, voided_at, voided_reason")
    .not("signature", "is", null)
    .order("serial");
  if (error) check("read badge_copies", false, error.message);
  let bad = 0;
  let pending = 0;
  const serials = new Map();
  for (const c of copies ?? []) {
    serials.set(c.def_id, [...(serials.get(c.def_id) ?? []), c.serial]);
    if (c.resign_pending) {
      pending++;
      continue;
    }
    const fields = {
      copyId: c.id, defId: c.def_id, series: c.series, serial: c.serial, holderId: c.holder_id, issuerId: c.issuer_id, mintedAt: c.minted_at,
      artHash: c.art_hash, name: c.name, flavor: c.flavor, stats: c.stats, event: { kind: c.event_kind, ref: c.event_ref, label: c.event_label },
    };
    if (cert.artHash(c.art_svg) !== c.art_hash || !cert.verifyCert(fields, c.signature, keys.get(c.issuer_id))) bad++;
    // A transfer kept the signature it had for the holder before.
    for (const h of c.history ?? []) {
      if (h.kind === "transferred" && h.signature && !cert.verifyCert({ ...fields, holderId: h.from_holder }, h.signature, keys.get(c.issuer_id))) bad++;
    }
  }
  check(`every signed copy verifies, and its pre-transfer signatures (${copies?.length ?? 0})`, bad === 0, bad ? `${bad} don't` : "");
  if (pending) console.log(`      ${pending} transferred copies waiting to be re-signed (the badge pages sign them)`);
  const { data: retired } = await db.from("badge_retired_serials").select("def_id, serial, reason");
  const { data: counts } = await db.from("badge_defs").select("id, minted_count");
  const minted = new Map((counts ?? []).map((d) => [d.id, d.minted_count]));
  const retiredSet = new Set((retired ?? []).map((r) => `${r.def_id}:${r.serial}`));
  check(
    "serials never repeat, never reuse a retired one, and stay within minted_count",
    [...serials.entries()].every(([d, s]) => new Set(s).size === s.length && s.every((n) => !retiredSet.has(`${d}:${n}`) && n <= (minted.get(d) ?? 0))),
  );
  const voided = (copies ?? []).filter((c) => c.voided_at);
  check(`voided copies keep a reason and a history line (${voided.length})`, voided.every((c) => (c.voided_reason ?? "").length >= 3 && (c.history ?? []).some((h) => h.kind === "voided")));

  // A rehearsal of the permanence rule in the database, rolled back.
  const { Client } = await import("pg");
  const pg = new Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER || "postgres",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();
  const q = async (sql, args = []) => (await pg.query(sql, args)).rows;
  const refused = async (sql, args = []) => {
    await pg.query("savepoint t");
    try {
      await pg.query(sql, args);
      await pg.query("release savepoint t");
      return false;
    } catch {
      await pg.query("rollback to savepoint t");
      return true;
    }
  };
  try {
    await pg.query("begin");
    const [def] = await q("select d.id, d.issuer_id from badge_defs d order by set_number limit 1");
    const [{ id: hA }] = await q("insert into badge_holders (display_name) values ('Rehearsal A') returning id");
    const [{ id: hB }] = await q("insert into badge_holders (display_name) values ('Rehearsal B') returning id");
    const mint = async (holder, mintedAt = null) => {
      const [{ c }] = await q("select public.badge_reserve_copy($1, $2, null, gen_random_uuid(), $3, '{}'::jsonb, null, null, null, $4) as c", [def.id, holder, Math.random().toString(36).slice(2, 14).padEnd(12, "2"), mintedAt]);
      const fields = { copyId: c.id, defId: c.def_id, series: c.series, serial: c.serial, holderId: c.holder_id, issuerId: c.issuer_id, mintedAt: c.minted_at, artHash: "ab", name: c.name, flavor: c.flavor, stats: c.stats, event: { kind: null, ref: null, label: null } };
      const s = cert.signCert(fields, priv);
      await q("update badge_copies set art_svg = '<svg/>', art_hash = 'ab', signature = $2 where id = $1", [c.id, s]);
      return { ...c, fields, signature: s };
    };
    const old = await mint(hA, new Date(Date.now() - 3600_000).toISOString());
    check("db: a signed copy can't be deleted", await refused("delete from badge_copies where id = $1", [old.id]));
    check("db: a signed copy's face can't change", await refused("update badge_copies set name = 'x' where id = $1", [old.id]));
    check("db: nor its holder, outside a transfer", await refused("update badge_copies set holder_id = $2 where id = $1", [old.id, hB]));

    const [{ n }] = await q("select public.badge_transfer_holder($1, $2) as n", [hA, hB]);
    const [t] = await q("select * from badge_copies where id = $1", [old.id]);
    const line = t.history.at(-1);
    check(
      "db: a transfer moves it to the new holder, same serial and mint time",
      n === 1 && t.holder_id === hB && t.serial === old.serial && t.minted_at.getTime() === new Date(old.minted_at).getTime() && t.resign_pending,
    );
    check("db: the transfer is in its history with the old signature", line?.kind === "transferred" && line.signature === old.signature && line.from_holder === hA);
    const newSig = cert.signCert({ ...old.fields, holderId: hB }, priv);
    const [{ ok: re1 }] = await q("select public.badge_resign_copy($1, $2, $3) as ok", [old.id, old.signature, newSig]);
    const [{ ok: re2 }] = await q("select public.badge_resign_copy($1, $2, $3) as ok", [old.id, old.signature, newSig]);
    const [r] = await q("select signature, resign_pending from badge_copies where id = $1", [old.id]);
    check("db: re-signed once, for the new holder", re1 && !re2 && r.signature === newSig && !r.resign_pending && cert.verifyCert({ ...old.fields, holderId: hB }, r.signature, pub));
    check("db: a history line can't be taken out", await refused("update badge_copies set history = '[]'::jsonb where id = $1", [old.id]));

    check("db: a void needs a reason", await refused("select public.badge_void_copy($1, ' ', null)", [t.code]));
    const [{ v }] = await q("select public.badge_void_copy($1, 'Rehearsal fraud', null) as v", [t.code]);
    const [{ v: v2 }] = await q("select public.badge_void_copy($1, 'Again', null) as v", [t.code]);
    const [vd] = await q("select voided_at, voided_reason, signature from badge_copies where id = $1", [old.id]);
    check("db: void marks it, once, and keeps the signature", v.ok && !v2.ok && vd.voided_at && vd.voided_reason === "Rehearsal fraud" && vd.signature === newSig);
    check("db: a void can't be undone", await refused("update badge_copies set voided_at = null where id = $1", [old.id]));
    check("db: a voided copy can't be deleted", await refused("delete from badge_copies where id = $1", [old.id]));

    const [m] = await q("select id from members where erased_at is null limit 1");
    const [{ id: claim }] = await q("insert into member_badges (member_id, badge, period, points) values ($1, 'zz_rehearsal', '', 0) returning id", [m.id]);
    const [{ c: fresh }] = await q("select public.badge_reserve_copy($1, $2, $3, gen_random_uuid(), 'zzzzzzzzzzzz', '{}'::jsonb) as c", [def.id, hA, `member_badges:${claim}`]);
    const [{ id: claim2 }] = await q("insert into member_badges (member_id, badge, period, points) values ($1, 'zz_rehearsal2', '', 0) returning id", [m.id]);
    const [{ c: sealed }] = await q("select public.badge_reserve_copy($1, $2, $3, gen_random_uuid(), 'zzzzzzzzzzzy', '{}'::jsonb, null, null, null, now() - interval '11 minutes') as c", [def.id, hA, `member_badges:${claim2}`]);
    await q("delete from member_badges where id = any($1::uuid[])", [[claim, claim2]]);
    const [{ u }] = await q("select public.badge_undo_claims($1::uuid[]) as u", [[claim, claim2]]);
    const left = await q("select id from badge_copies where id = any($1::uuid[])", [[fresh.id, sealed.id]]);
    const [ret] = await q("select reason from badge_retired_serials where def_id = $1 and serial = $2", [def.id, fresh.serial]);
    check("db: an undo inside 10 minutes removes the copy and retires its serial", u.removed === 1 && !left.some((x) => x.id === fresh.id) && ret?.reason === "unsealed");
    check("db: an undo after 10 minutes leaves the sealed copy", u.kept === 1 && left.some((x) => x.id === sealed.id));
    const [{ c: none }] = await q("select public.badge_reserve_copy($1, $2, $3, gen_random_uuid(), 'zzzzzzzzzzzx', '{}'::jsonb) as c", [def.id, hA, `member_badges:${claim}`]);
    check("db: a claim undone before minting gets no copy", none === null);
    const [{ serial: next }] = await q("select (public.badge_reserve_copy($1, $2, null, gen_random_uuid(), 'zzzzzzzzzzzw', '{}'::jsonb)->>'serial')::int as serial", [def.id, hB]);
    check("db: the next serial skips the retired one, never reuses it", next > fresh.serial);

    const [{ e }] = await q("select public.badge_erase_holder_copies($1) as e", [hB]);
    const gone = await q("select reason from badge_retired_serials where def_id = $1 and serial in ($2, $3)", [def.id, old.serial, next]);
    check("db: erasing removes every copy of the holder and holders merged into it, voided too, serials retired", e === 3 && gone.length === 2 && gone.every((g) => g.reason === "erased"));
    const [trig] = await q("select count(*)::int as n from pg_trigger where tgname in ('badge_copies_guard_delete', 'member_merges_transfer_badges') and not tgisinternal");
    check("db: the delete guard and the merge transfer are installed", trig.n === 2);
  } finally {
    await pg.query("rollback").catch(() => {});
    await pg.end();
  }
  const { data: defs } = await db.from("badge_defs").select("key, rule_type, rule_params, period, points, reward");
  const drift = rules.FALLBACK_DEFS.filter((f) => {
    const d = (defs ?? []).find((x) => x.key === f.key);
    return !d || d.rule_type !== f.ruleType || JSON.stringify(d.rule_params) !== JSON.stringify(f.params) || d.period !== f.period || d.points !== f.points || (d.reward ?? null) !== f.reward;
  });
  check("the catalog's Series 1 rules match the built-in list", drift.length === 0, drift.map((d) => d.key).join(", "));
}

console.log(failures ? `\n${failures} FAILED` : "\nAll passed.");
process.exit(failures ? 1 : 0);
