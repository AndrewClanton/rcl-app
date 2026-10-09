// Checks event badges (Badge Case build 2, lib/badges/events.ts):
//  1. Series guesses from titles (lib/event-series.ts).
//  2. A Members' Showing never shows a members-only or unadvertisable
//     title (lib/badges/attendance.ts showingLabel).
//  3. An event copy's certificate (event kind, ref, label, its stats) signs
//     and verifies with a fresh key, and changing the label breaks it.
//  4. With --db: who came to each series tag (a dry run: nothing awarded),
//     and every active event badge's dry-run count.
//
// Usage: node scripts/check-event-badges.mjs [--db]
import { register } from "node:module";
import { generateKeyPairSync } from "node:crypto";
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

const { guessSeries, MEMBERS_SHOWING } = await import("../src/lib/event-series.ts");
const cert = await import("../src/lib/badges/cert.ts");
const art = await import("../src/lib/badges/art.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ---------- 1. guesses ----------
const cases = [
  ["Trivia Night", "Trivia"],
  ["Movie Trivia: 90s", "Trivia"],
  ["Comedy Night", "Comedy"],
  ["Stand-up Showcase", "Comedy"],
  ["Book Swap", "Book Swap"],
  ["Horror Month: The Thing", "Horror Month"],
  ["Beetlejuice (member screening)", MEMBERS_SHOWING],
  ["Midweek Movie: Clue", "Midweek Movies"],
  ["Open Mic Night", null],
  ["Saving Private Ryan", null],
  ["The Outsiders", null],
];
for (const [t, want] of cases) check(`guess "${t}"`, guessSeries(t) === want, `got ${guessSeries(t)}`);
check("a manager's own tag matches by name", guessSeries("Karaoke Night", ["Trivia", "Karaoke"]) === "Karaoke");

// ---------- 2. public faces ----------
const { showingLabel } = await import("../src/lib/badges/attendance.ts");
const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(new Date()));
const at = new Date().toISOString();
check("public, this year's film: its title", showingLabel({ starts_at: at, visibility: "public", movie: { title: "New Film", release_year: year } }) === "New Film");
check("public, older film (MPLC): Members' Showing", showingLabel({ starts_at: at, visibility: "public", movie: { title: "Old Film", release_year: 1988 } }) === MEMBERS_SHOWING);
check("members only: Members' Showing", showingLabel({ starts_at: at, visibility: "members", movie: { title: "New Film", release_year: year } }) === MEMBERS_SHOWING);
check("private: Members' Showing, never the group", showingLabel({ starts_at: at, visibility: "private", movie: { title: "Easter Seals matinee", release_year: year } }) === MEMBERS_SHOWING);
check("no release year: Members' Showing", showingLabel({ starts_at: at, visibility: "public", movie: { title: "Unmatched", release_year: null } }) === MEMBERS_SHOWING);

// ---------- 3. an event copy's certificate ----------
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const priv = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const svg = art.renderArt(art.STARTERS.find((s) => s.name === "Trivia Night").spec);
const fields = {
  copyId: "8f0d7c2e-1b2a-4f5e-9a1b-0c2d3e4f5a6b",
  defId: "11111111-2222-4333-8444-555555555555",
  series: 1,
  serial: 3,
  holderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  issuerId: "99999999-8888-4777-8666-555555555555",
  mintedAt: "2026-10-09T23:12:33.123+00:00",
  artHash: cert.artHash(svg),
  name: "Trivia Regular",
  flavor: "Came to 5 Trivia nights.",
  stats: { date: "Oct 9, 2026", nth: "5th Trivia night" },
  event: { kind: "house_event", ref: "0b6c1f2e-3a4b-4c5d-8e9f-a0b1c2d3e4f5", label: "Trivia Night" },
};
const sig = cert.signCert(fields, priv);
check("event certificate verifies", cert.verifyCert(fields, sig, pub));
check("changing its event label breaks it", !cert.verifyCert({ ...fields, event: { ...fields.event, label: "Something else" } }, sig, pub));
check("changing its nth breaks it", !cert.verifyCert({ ...fields, stats: { ...fields.stats, nth: "6th Trivia night" } }, sig, pub));

// ---------- 4. the database: dry runs ----------
if (process.argv.includes("--db")) {
  const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
  const events = await import("../src/lib/badges/events.ts");
  const db = createAdminClient();
  const tags = (await db.from("event_series").select("name")).data ?? [];
  for (const t of tags) {
    const r = await events.countEarners({ kind: "series", match: t.name, times: 1 });
    console.log(`INFO  came to any ${t.name}: ${r.came}`);
  }
  const dry = await events.awardEventBadges({ dryRun: true, fresh: true });
  const defs = Object.values(dry.perDef);
  console.log(`INFO  active event badges: ${defs.length}${defs.map((d) => `; ${d.name}: ${d.came} came, ${d.toAward} to award`).join("")}`);
  check("dry run awarded nothing", defs.every((d) => d.awarded === 0));
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);
