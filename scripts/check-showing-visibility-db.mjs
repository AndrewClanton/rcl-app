// Checks who sees a showing (screenings.visibility, src/lib/showing-visibility.ts)
// against the real database: adds a made-up film with one Public, one
// Members-only and one Private showing tomorrow, runs them through the
// public data paths, then removes them again.
//  1. The public listing's filter (onlyPublicShowings: Showtimes, Home, the
//     sitemap, the lobby TVs, search markup) keeps only the Public one.
//  2. A guest gets no members-only showings; a member gets only the
//     Members-only one, never the Private one.
//  3. The weekly email lineup leaves the Private one out and puts the
//     Members-only one in the members-only section.
//  4. Search markup (JSON-LD) is only made for the Public one.
//  5. A whole-page load of the Private one's page is turned into the 404 by
//     the proxy's gate; the Public one passes.
//
// Usage: node scripts/check-showing-visibility-db.mjs   (needs .env.local)
import { register } from "node:module";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s.startsWith("@/")) {
          try { return await next(${JSON.stringify(srcRoot)} + s.slice(2) + ".ts", c); }
          catch { return next(${JSON.stringify(srcRoot)} + s.slice(2) + ".tsx", c); }
        }
        if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
        if (s === "next/server" || s === "next/cache") return next(s + ".js", c);
        return next(s, c);
      }`,
    ),
);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { onlyPublicShowings, getMembersOnlyScreenings } = await import("../src/lib/data/screenings.ts");
const { visibilityOf } = await import("../src/lib/showing-visibility.ts");
const { getLineup } = await import("../src/lib/data/lineup.ts");
const { screeningEventJsonLd } = await import("../src/lib/seo/screening-events.ts");
const { rewriteMissingShowtime } = await import("../src/lib/showtime-gate.ts");
const { centralYear } = await import("../src/lib/mplc.ts");
const { NextRequest } = await import("next/server.js");

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

const { data: room } = await db.from("rooms").select("id").eq("is_screening_room", true).limit(1).single();
const title = `ZZ visibility check ${Date.now()}`;
const { data: movie, error: mErr } = await db.from("movies").insert({ title, release_year: centralYear() }).select("id").single();
if (mErr) throw mErr;

// Tomorrow at 3:1x AM Central-ish: odd minutes nobody schedules.
const base = Date.now() + 26 * 3_600_000;
const iso = (n) => new Date(Math.floor(base / 60_000) * 60_000 + n * 60_000).toISOString();
const ids = {};
try {
  for (const [n, visibility] of [[0, "public"], [1, "members"], [2, "private"]]) {
    const { data, error } = await db
      .from("screenings")
      .insert({ movie_id: movie.id, room_id: room.id, starts_at: iso(n), ticket_price: 8, capacity: 5, visibility })
      .select("id")
      .single();
    if (error) throw error;
    ids[visibility] = data.id;
  }

  // The same rows the public listing reads (readPublicRows).
  const { data: rows, error } = await db.from("screenings").select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))").eq("movie_id", movie.id);
  if (error) throw error;
  const listed = onlyPublicShowings(rows).map((s) => s.id);
  check(listed.length === 1 && listed[0] === ids.public, "public listing: only the Public showing");

  check((await getMembersOnlyScreenings(null)).length === 0, "a guest gets no members-only showings");
  const forMember = rows.filter((s) => visibilityOf(s) === "members").map((s) => s.id);
  check(forMember.length === 1 && forMember[0] === ids.members, "a member's extra showings: only the Members-only one");
  check(visibilityOf({}) === "private" && visibilityOf({ visibility: "odd" }) === "private", "an unknown or missing visibility counts as private");

  const lineup = await getLineup(undefined, 3);
  const ours = lineup.films.filter((f) => f.title === title);
  const shown = ours.flatMap((f) => f.showtimes.map((t) => t.id));
  check(!shown.includes(ids.private), "email lineup leaves the Private showing out");
  check(ours.some((f) => !f.archive && f.showtimes.some((t) => t.id === ids.public)), "email lineup: the Public showing in an ordinary card");
  check(ours.some((f) => f.archive && f.showtimes.some((t) => t.id === ids.members)), "email lineup: the Members-only showing in the members-only section");

  const ld = Object.fromEntries(rows.map((s) => [visibilityOf(s), !!screeningEventJsonLd(s)]));
  check(ld.public && !ld.members && !ld.private, "search markup only for the Public showing");

  const page = (id) => new NextRequest(`https://example.test/showtimes/${id}`, { headers: { "sec-fetch-dest": "document" } });
  const privateGate = await rewriteMissingShowtime(page(ids.private));
  const publicGate = await rewriteMissingShowtime(page(ids.public));
  check(!!privateGate && publicGate === null, "the Private showing's page is a 404 at the gate; the Public one passes");
} finally {
  await db.from("screenings").delete().in("id", Object.values(ids));
  await db.from("movies").delete().eq("id", movie.id);
  const { count } = await db.from("screenings").select("id", { count: "exact", head: true }).eq("movie_id", movie.id);
  console.log(count === 0 ? "cleaned up" : "CLEANUP FAILED: remove the test film by hand");
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
