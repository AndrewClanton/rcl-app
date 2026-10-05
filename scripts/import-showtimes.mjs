// Loads showtimes from the showtimes spreadsheet (saved as CSV) into the
// schedule. Shows what it would do first; nothing is written without --apply.
//
// Usage:
//   node scripts/import-showtimes.mjs showtimes.csv            (dry run)
//   node scripts/import-showtimes.mjs showtimes.csv --apply    (adds them)
//
// Columns (header row, any order, any capitalization):
//   date      2026-10-14, 10/14/2026 or 10/14 (this year)
//   time      7:00 PM, 7pm or 19:00 (Central)
//   title     the film, matched to a movie already in Back office > Showtimes
//             (also "movie" or "film")
//   room      optional: "outdoor" for the outdoor screen, else the indoor
//             cinema (also "screen")
//   price     optional: the ticket price (default $8, outdoor $0)
//   capacity  optional: seats (default the room's capacity; also "seats")
//
// Who sees a showing comes from a note on the end of its title
// (src/lib/showing-visibility.ts), with or without parentheses:
//   "Beetlejuice 2 (member screening)" or "(members only)"   -> Members only
//   "Beetlejuice 2 (private event do not list)", "(private)" or "(do not list)" -> Private
// The note is taken off before the title is matched. Anything else is Public.
//
// A showing already on the schedule (same room, same start) is skipped, so
// running it twice adds nothing twice. A title that matches no movie is
// listed and skipped: add the film in Back office first, then run it again.
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parseShowingTitle, isOutdoorRoom } from "../src/lib/showing-visibility.ts";

config({ path: ".env.local", quiet: true });

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!file) {
  console.error("Usage: node scripts/import-showtimes.mjs <showtimes.csv> [--apply]");
  process.exit(1);
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// ---------- dates and times (Central) ----------
function parseDate(s) {
  s = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(new Date().getFullYear());
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}
function parseTime(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0]?.toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}
function centralHour(ms) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
}
function centralToIso(date, [h, m]) {
  let t = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`) + 5 * 3_600_000; // as if CDT
  const got = centralHour(t);
  if (got !== h) t += (h - got) * 3_600_000; // CST
  return new Date(t).toISOString();
}

// ---------- matching titles to movies ----------
const ROMAN = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6" };
function norm(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
    .filter((w, i) => !(i === 0 && w === "the"))
    .join(" ");
}
// "Beetlejuice 2" is also "Beetlejuice Beetlejuice", the sequel's real name.
function variants(title) {
  const n = norm(title);
  const out = new Set([n, n.replace(/ part (\d)$/, " $1")]);
  const sequel = / (\d)$/.exec(n);
  if (sequel?.[1] === "2") out.add(`${n.slice(0, -2)} ${n.slice(0, -2)}`);
  return out;
}
function matchMovie(title, movies) {
  const want = variants(title);
  const exact = movies.filter((m) => want.has(norm(m.title)));
  if (exact.length) return exact;
  // "Beetlejuice 2" for "Beetlejuice 2: The Afterlife": the title before a colon.
  return movies.filter((m) => want.has(norm(m.title.split(":")[0])));
}

// ---------- go ----------
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: movies, error: mErr }, { data: rooms, error: rErr }] = await Promise.all([
  db.from("movies").select("id, title, release_year"),
  db.from("rooms").select("id, key, name, capacity, is_screening_room"),
]);
if (mErr || rErr) throw mErr ?? rErr;
const outdoorRoom = rooms.find((r) => isOutdoorRoom(r));
const indoorRoom = rooms.find((r) => r.is_screening_room && !isOutdoorRoom(r));

const [header, ...lines] = parseCsv(readFileSync(file, "utf8"));
const col = (...names) => header.findIndex((h) => names.includes(h.trim().toLowerCase()));
const C = { date: col("date", "day"), time: col("time", "start", "start time"), title: col("title", "movie", "film"), room: col("room", "screen"), price: col("price", "ticket price"), capacity: col("capacity", "seats") };
if (C.date < 0 || C.time < 0 || C.title < 0) {
  console.error(`The first row needs "date", "time" and "title" columns. Found: ${header.join(", ")}`);
  process.exit(1);
}

const toAdd = [];
const problems = [];
const counts = { public: 0, members: 0, private: 0 };
lines.forEach((cells, i) => {
  const line = i + 2;
  const raw = (cells[C.title] ?? "").trim();
  if (!raw) return;
  const { title, visibility } = parseShowingTitle(raw);
  const date = parseDate(cells[C.date] ?? "");
  const time = parseTime(cells[C.time] ?? "");
  if (!date || !time) return problems.push(`Row ${line}: "${cells[C.date]}" "${cells[C.time]}" isn't a date and time.`);
  const found = matchMovie(title, movies);
  if (found.length !== 1) return problems.push(`Row ${line}: "${title}" ${found.length ? `matches ${found.length} movies (${found.map((m) => m.title).join(", ")})` : "matches no movie. Add it in Back office first"}.`);
  const room = C.room >= 0 && /outdoor|patio/i.test(cells[C.room] ?? "") ? outdoorRoom : indoorRoom;
  if (!room) return problems.push(`Row ${line}: no such room.`);
  const outdoor = isOutdoorRoom(room);
  const priceText = C.price >= 0 ? (cells[C.price] ?? "").replace(/[$\s]/g, "") : "";
  const capText = C.capacity >= 0 ? (cells[C.capacity] ?? "").trim() : "";
  const row = {
    movie_id: found[0].id,
    room_id: room.id,
    starts_at: centralToIso(date, time),
    ticket_price: priceText ? Number(priceText) : outdoor ? 0 : 8,
    capacity: capText ? parseInt(capText, 10) : room.capacity,
    visibility,
  };
  if (!(row.ticket_price >= 0) || !(row.capacity > 0)) return problems.push(`Row ${line}: check the price and capacity.`);
  counts[visibility]++;
  toAdd.push({ row, label: `${date} ${cells[C.time].trim()}  ${found[0].title}  ${outdoor ? "[outdoor]" : ""} ${visibility === "public" ? "" : `[${visibility === "members" ? "Members only" : "Private"}]`}` });
});

// Skip what's already on the schedule.
const fresh = [];
for (const item of toAdd) {
  const { data, error } = await db.from("screenings").select("id").eq("room_id", item.row.room_id).eq("starts_at", item.row.starts_at).limit(1);
  if (error) throw error;
  if (data.length) console.log(`  already on the schedule: ${item.label}`);
  else fresh.push(item);
}

for (const p of problems) console.log(`  SKIPPED ${p}`);
for (const item of fresh) console.log(`  ${apply ? "adding" : "would add"}: ${item.label}`);
console.log(`\n${fresh.length} to add (${counts.public} public, ${counts.members} members only, ${counts.private} private in the sheet), ${problems.length} skipped.`);

if (!apply) {
  console.log("Dry run: nothing written. Run again with --apply to add them.");
} else if (fresh.length) {
  const { error } = await db.from("screenings").insert(fresh.map((f) => f.row));
  if (error) throw error;
  console.log(`Added ${fresh.length}. The website picks them up within a minute.`);
}
