// Tags showings and house events (past and already scheduled) with a series (Badge Case build 2,
// lib/event-series.ts), once, where it's obvious:
//   - a house event or a film whose title names a series ("Trivia Night",
//     "Comedy Night", "Book Swap")
//   - a showing on the outdoor screen: Outdoor
//   - a members-only showing: Members' Showing
// Private showings are never tagged. Anything already tagged is left alone.
// Counts first; nothing is written without --apply.
//
// Usage: node scripts/backfill-event-series.mjs            (dry run)
//        node scripts/backfill-event-series.mjs --apply
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
const { guessSeries, MEMBERS_SHOWING } = await import("../src/lib/event-series.ts");
const { isOutdoorRoom } = await import("../src/lib/showing-visibility.ts");
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");

const db = createAdminClient();
const must = (r, what) => {
  if (r.error) {
    console.error(`${what}: ${r.error.message}`);
    process.exit(1);
  }
  return r.data;
};
async function all(make, what) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await make().range(from, from + 999), what);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

console.log(apply ? "APPLYING" : "DRY RUN (add --apply to write)");
const now = new Date().toISOString();
const tags = must(await db.from("event_series").select("name").eq("active", true), "series list").map((t) => t.name);
const rooms = must(await db.from("rooms").select("id, key, name"), "rooms");
const outdoor = new Set(rooms.filter((r) => isOutdoorRoom(r)).map((r) => r.id));

const events = await all(() => db.from("house_events").select("id, title, series, starts_at").order("starts_at"), "house events");
const shows = await all(() => db.from("screenings").select("id, starts_at, room_id, visibility, series, movie:movies(title)").order("starts_at"), "screenings");

const plan = []; // { table, id, series, why }
for (const e of events) {
  if (e.series) continue;
  const g = guessSeries(e.title, tags);
  if (g) plan.push({ table: "house_events", id: e.id, series: g, why: "title", label: e.title, past: e.starts_at < now });
}
for (const s of shows) {
  if (s.series || s.visibility === "private") continue;
  const title = s.movie?.title ?? "";
  let g = guessSeries(title, tags);
  let why = "title";
  if (!g && outdoor.has(s.room_id) && tags.includes("Outdoor")) [g, why] = ["Outdoor", "outdoor screen"];
  if (!g && s.visibility === "members" && tags.includes(MEMBERS_SHOWING)) [g, why] = [MEMBERS_SHOWING, "members only"];
  if (g) plan.push({ table: "screenings", id: s.id, series: g, why, label: title, past: s.starts_at < now });
}

console.log(`House events: ${events.length} (${events.filter((e) => e.series).length} already tagged)`);
console.log(`Showings: ${shows.length} (${shows.filter((s) => s.series).length} already tagged)`);
const counts = {};
for (const p of plan) {
  const k = `${p.table === "house_events" ? "house event" : "showing"} -> ${p.series} (${p.why}, ${p.past ? "past" : "scheduled"})`;
  counts[k] = (counts[k] ?? 0) + 1;
}
console.log(plan.length ? "To tag:" : "Nothing to tag.");
for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
const examples = plan.filter((p) => p.why === "title").slice(0, 12);
if (examples.length) console.log("Title matches, e.g.:", examples.map((p) => `"${p.label}" -> ${p.series}`).join("; "));

if (!apply) process.exit(0);
let done = 0;
for (const table of ["house_events", "screenings"]) {
  const bySeries = new Map();
  for (const p of plan.filter((x) => x.table === table)) bySeries.set(p.series, [...(bySeries.get(p.series) ?? []), p.id]);
  for (const [series, ids] of bySeries) {
    for (let i = 0; i < ids.length; i += 150) {
      const rows = must(await db.from(table).update({ series }).in("id", ids.slice(i, i + 150)).is("series", null).select("id"), `tag ${table}`);
      done += rows.length;
    }
  }
}
console.log(`Tagged ${done}.`);
