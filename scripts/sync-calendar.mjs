// Syncs the schedule with the "RCL Calendar 2026" spreadsheet, saved as text
// (CSV). Only the "OCT/NOV/DEC CALENDAR" tabs are read ("Copy of ..." tabs
// are ignored), and only from today's business night onward (the business
// day runs 4 AM to 4 AM Central, so "12AM" belongs to the night before).
//
// Usage:
//   node scripts/sync-calendar.mjs calendar.txt                 (dry run)
//   node scripts/sync-calendar.mjs calendar.txt --out report.txt
//   node scripts/sync-calendar.mjs calendar.txt --apply         (writes)
//
// Columns per tab: DATE, DAY, TIME, MOVIE TITLE, SOURCE, [OUTDOOR] TIME,
// MOVIE TITLE, SOURCE, NOTES... A row with no date belongs to the date above.
//
// Rules:
//   - Outdoor-column titles go on the Outdoor Cinema at the outdoor time;
//     indoor titles go on the Indoor Cinema. Price $8 indoor / $0 outdoor,
//     capacity the room's, as in Back office > Showtimes.
//   - "(do not include on website)", "private ...", "Private Rental/Event/
//     Screening <TITLE> - name" -> Private (the film's title is kept).
//   - The outdoor screen and Wednesday 8 PM Midweek Movies -> Members only
//     (they aren't licensed for public advertising).
//   - Everything else -> Public (older titles stay hidden by the MPLC rule).
//   - Trivia, comedy, open mic, book swap, CLOSED, "No movie", Arc of the
//     Ozarks screenings, premiere events, filmmaker screenings, bare "Midweek
//     Movies", requests and blanks are skipped and listed.
//
// Compared with the database it lists TO ADD, TO CHANGE (room, time or
// visibility) and TO REMOVE. A showing with tickets sold is never removed or
// moved; it's flagged instead. A showing the calendar still names in a
// skipped note ("Zoe request Over the Garden Wall") is kept. --apply adds
// missing films from TMDb first, then writes adds, changes and removals.
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parseShowingTitle, isOutdoorRoom } from "../src/lib/showing-visibility.ts";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const apply = args.includes("--apply");
// --tmdb looks the missing films up on TMDb and says what it would add;
// --apply adds them (as Back office > Showtimes > search does).
const lookUp = apply || args.includes("--tmdb");
if (!file) {
  console.error("Usage: node scripts/sync-calendar.mjs <calendar.txt> [--out report.txt] [--apply]");
  process.exit(1);
}

// ---------- reading the export ----------
// Rows may come joined by spaces instead of line breaks, so rows are cut by
// their fixed cell count (every row of a tab has as many cells as its header).
function cells(text) {
  const out = [];
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
    else if (c === "," || c === "\n" || c === "\r") {
      out.push(cell);
      cell = "";
    }
    else cell += c;
  }
  out.push(cell);
  return out;
}
function rowsOf(section, width) {
  const raw = /[\r\n]/.test(section) ? section.split(/\r?\n|\r/).map(cells) : null;
  if (raw) return raw;
  const toks = cells(section);
  const rows = [];
  let carry = null;
  for (let i = 0; i < toks.length; ) {
    const row = [];
    if (carry !== null) {
      row.push(carry);
      carry = null;
    }
    while (row.length < width && i < toks.length) row.push(toks[i++]);
    // The last cell holds "<last cell> <first cell of the next row>".
    if (row.length === width && i < toks.length) {
      const last = row[width - 1];
      const k = last.lastIndexOf(" ");
      row[width - 1] = k >= 0 ? last.slice(0, k) : last;
      carry = k >= 0 ? last.slice(k + 1) : "";
    }
    rows.push(row);
  }
  return rows;
}
const clean = (s) => (s ?? "").replace(/\\/g, "").replace(/[￼ ]/g, " ").replace(/\s+/g, " ").trim();

const text = readFileSync(file, "utf8");
// The tabs we want: "OCT CALENDAR", "NOV CALENDAR", "DEC CALENDAR", not "Copy of ...".
const tabRe = /(^|[\s,])((?:Copy of )?[A-Z]{3} CALENDAR)(?=,)/g;
const marks = [...text.matchAll(tabRe)].map((m) => ({ name: m[2], at: m.index + m[1].length }));
const tabs = marks
  .map((m, i) => ({ name: m.name, body: text.slice(m.at, marks[i + 1]?.at ?? text.length) }))
  .filter((t) => !/copy of/i.test(t.name) && /^(OCT|NOV|DEC) /.test(t.name));

// ---------- dates and times (Central) ----------
function parseClock(s, fallbackAp) {
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = (m[3]?.[0] ?? fallbackAp ?? "p").toLowerCase(); // "7:30" is evening
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h > 23 || min > 59 ? null : [h, min];
}
// "8PM", "1145 AM", "830PM", "5-8PM", "1130AM-230PM": the start time.
function parseStart(s) {
  const [a, b] = clean(s).split(/\s*-\s*/);
  if (!a) return null;
  const endAp = b ? /([ap])\.?m/i.exec(b)?.[1] : undefined;
  return parseClock(a, /[ap]\.?m/i.test(a) ? undefined : endAp);
}
function centralHour(ms) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
}
function centralToIso(date, [h, m]) {
  let t = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`) + 5 * 3_600_000;
  const got = centralHour(t);
  if (got !== h) t += (h - got) * 3_600_000;
  return new Date(t).toISOString();
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const centralDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ms));
// The business night a moment belongs to: 4 AM to 4 AM Central.
const businessDate = (ms) => (centralHour(ms) < 4 ? addDays(centralDate(ms), -1) : centralDate(ms));
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (date) => DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
function clock(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "").replace(" ", " ");
}
const today = businessDate(Date.now());

// ---------- what a cell says ----------
const SKIP = [
  [/\btrivia\b/i, "trivia"],
  [/\bcomedy\b/i, "comedy"],
  [/open mic/i, "open mic"],
  [/book swap/i, "book swap"],
  [/^closed$/i, "closed"],
  [/\bno (movie|showing|film)\b/i, "no movie"],
  [/arc (of the )?ozarks/i, "Arc of the Ozarks screening, no title"],
  [/premiere event/i, "premiere event"],
  [/filmmaker/i, "filmmaker screening"],
  [/^midweek movies$/i, "Midweek Movies placeholder, no title"],
  [/\brequest\b/i, "a request, not a booked title"],
  [/football|super ?bowl/i, "not a movie"],
  [/\bevent$/i, "an event, no title"],
];
const STATUS = /^(CONFIRMED|TENTATIVE|ENTIRE|BUILDING|WEST|HALL|ONLY|OWES|FULL|BALANCE)$/;
// -> { skip: reason } or { title, year, visibility }
function readTitle(raw) {
  let t = clean(raw);
  if (!t) return { skip: null };
  for (const [re, why] of SKIP) if (re.test(t)) return { skip: why };
  let visibility = "public";
  if (/\(?\s*do\s*n[o']?t\s+(include|list)[^)]*\)?/i.test(t)) {
    visibility = "private";
    t = t.replace(/\(?\s*do\s*n[o']?t\s+(include|list)[^)]*\)?/i, "").trim();
  }
  const priv = /^\(?\s*private\s*(rental|screening|event)?\b\s*[-:]?\s*/i.exec(t);
  if (priv) {
    visibility = "private";
    // The sheet writes the film in capitals: "Private Rental GHOSTBUSTERS
    // 1984 - Entire Building - Mandy Woods". No capitals, no film named.
    const words = [];
    for (const w of t.slice(priv[0].length).split(/\s+/)) {
      if (w === "-" || !/^[A-Z0-9:'&!.,]+$/.test(w) || !/[A-Z0-9]/.test(w) || STATUS.test(w)) break;
      words.push(w);
    }
    t = words.join(" ");
    if (!t) return { skip: "private event, no film named" };
  } else {
    const p = parseShowingTitle(t);
    t = p.title;
    if (p.visibility !== "public") visibility = p.visibility;
  }
  t = t.replace(/\s*\([^)]*\)\s*$/, "").trim(); // "(it fits this runtime)"
  let year = null;
  const y = /\s(19\d\d|20\d\d)$/.exec(t);
  if (y) {
    year = Number(y[1]);
    t = t.slice(0, y.index).trim();
  }
  // "GHOSTBUSTERS" -> "Ghostbusters", "BEETLEJUICE 2" -> "Beetlejuice 2".
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());
  return { title: t, year, visibility };
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
function variants(title) {
  const n = norm(title);
  const out = new Set([n, n.replace(/ part (\d)$/, " $1"), n.replace(/ and /g, " ")]);
  const sequel = / (\d)$/.exec(n);
  if (sequel?.[1] === "2") out.add(`${n.slice(0, -2)} ${n.slice(0, -2)}`);
  return out;
}
function matchMovie(title, year, movies) {
  const want = variants(title);
  let found = movies.filter((m) => want.has(norm(m.title)) || want.has(norm(m.title).replace(/ and /g, " ")));
  if (!found.length) found = movies.filter((m) => want.has(norm(m.title.split(":")[0])));
  if (found.length > 1 && year) found = found.filter((m) => m.release_year === year);
  if (found.length > 1) {
    // Prefer the newest print of a remade title only when nothing says otherwise.
    found = [...found].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0));
  }
  return found[0] ?? null;
}

// ---------- the database ----------
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: movies, error: mErr }, { data: rooms, error: rErr }] = await Promise.all([
  db.from("movies").select("id, title, release_year"),
  db.from("rooms").select("id, key, name, capacity, is_screening_room"),
]);
if (mErr || rErr) throw mErr ?? rErr;
const outdoorRoom = rooms.find((r) => isOutdoorRoom(r));
const indoorRoom = rooms.find((r) => r.is_screening_room && !isOutdoorRoom(r));
const roomName = (id) => (id === outdoorRoom?.id ? "outdoor" : "indoor");

// ---------- the calendar ----------
const entries = [];
const skipped = [];
let blanks = 0;
for (const tab of tabs) {
  const headerRow = tab.body.match(/DATE,DAY,[^\n]*?KEY,?/)?.[0];
  const width = headerRow ? cells(headerRow.replace(/,KEY,$/, ",KEY")).length + (headerRow.endsWith(",") ? 1 : 0) : 12;
  const rows = rowsOf(tab.body, width);
  const header = rows.find((r) => clean(r[0]) === "DATE") ?? [];
  const titleCols = header.map((h, i) => (/MOVIE TITLE/i.test(h) ? i : -1)).filter((i) => i >= 0);
  const [inTitle, outTitle] = titleCols;
  const outTime = outTitle - 1 > inTitle && /TIME/i.test(header[outTitle - 1]) ? outTitle - 1 : -1;
  let date = null;
  for (const r of rows) {
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(r[0]));
    if (d) date = `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`;
    if (!date || date < today || clean(r[0]) === "DATE") continue;
    const slots = [{ room: indoorRoom, time: r[2], title: r[inTitle] }];
    if (outTitle >= 0) slots.push({ room: outdoorRoom, time: outTime >= 0 ? r[outTime] : "8PM", title: r[outTitle] });
    for (const s of slots) {
      const timeText = clean(s.time);
      const titleText = clean(s.title);
      const outdoor = s.room === outdoorRoom;
      const where = outdoor ? "outdoor" : "indoor";
      const start = parseStart(timeText);
      if (!titleText && !start && timeText) {
        // "CLOSED" or "FLANAGAN/INDI EVENT" written in the time column.
        const r2 = readTitle(timeText);
        skipped.push({ date, time: "", text: timeText, why: r2.skip ?? "not a time" });
        continue;
      }
      if (!titleText) {
        if (timeText) blanks++;
        continue;
      }
      const t = readTitle(titleText);
      if (t.skip !== undefined) {
        skipped.push({ date, time: timeText, text: `${titleText}${outdoor ? " (outdoor)" : ""}`, why: t.skip ?? "blank", room: s.room, start });
        continue;
      }
      if (!start) {
        skipped.push({ date, time: timeText, text: titleText, why: "no time I can read" });
        continue;
      }
      // After midnight (before 4 AM) is the next calendar day, same night.
      const calDate = start[0] < 4 ? addDays(date, 1) : date;
      let visibility = t.visibility;
      if (visibility !== "private" && outdoor) visibility = "members";
      if (visibility !== "private" && !outdoor && dayName(date) === "Wed" && start[0] === 20 && start[1] === 0) visibility = "members";
      entries.push({ date, where, room: s.room, starts_at: centralToIso(calDate, start), title: t.title, year: t.year, visibility, raw: titleText });
    }
  }
}

// ---------- films with no movie record ----------
const TMDB = "https://api.themoviedb.org/3";
async function tmdb(path) {
  const res = await fetch(`${TMDB}${path}`, { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } });
  if (!res.ok) throw new Error(`TMDb ${res.status} for ${path}`);
  return res.json();
}
// The sheet doesn't say which "Legend": a few remade titles, pinned by year.
const YEAR_HINT = { legend: 1985, ghostbusters: 1984 };
// The best TMDb hit for a calendar title: an exact title match (with the
// sheet's year, if it gave one), the most popular first.
async function findOnTmdb(title, year) {
  const want = variants(title);
  year ??= YEAR_HINT[norm(title)];
  // "The Corpse Bride" is "Corpse Bride" on TMDb.
  const queries = [title, ...[...want].filter((v) => v.split(" ").length > 1)];
  for (const q of new Set(queries)) {
    const json = await tmdb(`/search/movie?include_adult=false&query=${encodeURIComponent(q)}${year ? `&primary_release_year=${year}` : ""}`);
    const hits = (json.results ?? []).filter((h) => h.release_date);
    const exact = hits.filter((h) => want.has(norm(h.title)) || want.has(norm(h.title).replace(/ and /g, " ")) || norm(h.title) === norm(q));
    const pick = exact.sort((a, b) => b.popularity - a.popularity)[0];
    if (pick) return pick;
  }
  return null;
}
async function storePoster(key, posterPath) {
  if (!posterPath) return null;
  try {
    const res = await fetch(`https://image.tmdb.org/t/p/original${posterPath}`);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const path = `${key}.${ext}`;
    const { error } = await db.storage.from("movie-posters").upload(path, Buffer.from(await res.arrayBuffer()), { contentType: type, upsert: true });
    return error ? null : db.storage.from("movie-posters").getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}
const missing = new Map(); // norm(title) -> { title, year }
for (const e of entries) if (!matchMovie(e.title, e.year, movies)) missing.set(norm(e.title), missing.get(norm(e.title)) ?? { title: e.title, year: e.year });
const imported = [];
const notFound = [];
if (lookUp && missing.size) {
  if (!process.env.TMDB_API_KEY) throw new Error("TMDB_API_KEY is missing from .env.local");
  for (const m of missing.values()) {
    const hit = await findOnTmdb(m.title, m.year);
    if (!hit) {
      notFound.push(m.title);
      continue;
    }
    const d = await tmdb(`/movie/${hit.id}?append_to_response=external_ids,release_dates`);
    const us = (d.release_dates?.results ?? []).find((r) => r.iso_3166_1 === "US");
    const row = {
      tmdb_id: d.id,
      imdb_id: d.external_ids?.imdb_id || d.imdb_id || null,
      title: d.title,
      synopsis: d.overview || null,
      runtime_minutes: d.runtime || null,
      rating: (us?.release_dates ?? []).map((r) => r.certification).find((c) => !!c) ?? null,
      release_year: d.release_date ? Number(d.release_date.slice(0, 4)) : null,
    };
    imported.push({ asked: m.title, title: row.title, year: row.release_year });
    // Matched under the name the calendar uses, too ("Beetlejuice 2").
    const alias = { title: m.title, release_year: row.release_year };
    if (!apply) {
      movies.push({ id: `new:${d.id}`, title: row.title, release_year: row.release_year }, { ...alias, id: `new:${d.id}`, displayTitle: row.title });
      continue;
    }
    const match = row.imdb_id ? `tmdb_id.eq.${d.id},imdb_id.eq.${row.imdb_id}` : `tmdb_id.eq.${d.id}`;
    const { data: existing } = await db.from("movies").select("id, title, release_year").or(match).limit(1).maybeSingle();
    let saved = existing;
    if (!saved) {
      row.poster_url = await storePoster(row.imdb_id ?? `tmdb-${d.id}`, d.poster_path);
      const { data, error } = await db.from("movies").insert(row).select("id, title, release_year").single();
      if (error) throw error;
      saved = data;
    }
    movies.push(saved, { ...alias, id: saved.id, displayTitle: saved.title });
  }
}
for (const e of entries) {
  e.movie = matchMovie(e.title, e.year, movies);
  if (e.movie) e.title = e.movie.displayTitle ?? e.movie.title;
}

// ---------- compare ----------
const { data: dbRows, error: sErr } = await db
  .from("screenings")
  .select("id, starts_at, room_id, movie_id, visibility, ticket_price, capacity, movie:movies(title)")
  .gte("starts_at", centralToIso(today, [4, 0]))
  .in("room_id", [indoorRoom.id, outdoorRoom.id])
  .order("starts_at");
if (sErr) throw sErr;
const held = {};
for (let i = 0; i < dbRows.length; i += 50) {
  const ids = dbRows.slice(i, i + 50).map((s) => s.id);
  const { data, error } = await db.from("bookings").select("screening_id, quantity, status").in("screening_id", ids).in("status", ["confirmed", "pending"]);
  if (error) throw error;
  for (const b of data ?? []) held[b.screening_id] = (held[b.screening_id] ?? 0) + b.quantity;
}
const lastDate = entries.reduce((a, e) => (e.date > a ? e.date : a), today);

const used = new Set();
const toAdd = [];
const toChange = [];
const needs = new Map();
const same = Date.parse;
// 1) same movie, same room, same time.
for (const e of entries) {
  if (!e.movie) continue;
  const hit = dbRows.find((s) => !used.has(s.id) && s.movie_id === e.movie.id && s.room_id === e.room.id && same(s.starts_at) === same(e.starts_at));
  if (hit) {
    used.add(hit.id);
    e.matched = hit;
    if ((hit.visibility ?? "private") !== e.visibility) toChange.push({ e, s: hit, what: [`visibility ${hit.visibility} -> ${e.visibility}`] });
  }
}
// 2) same movie, same night, moved room or time.
for (const e of entries) {
  if (e.matched) continue;
  if (!e.movie) {
    const k = norm(e.title);
    needs.set(k, { title: needs.get(k)?.title ?? e.title, n: (needs.get(k)?.n ?? 0) + 1 });
    toAdd.push(e);
    continue;
  }
  const hit = dbRows.find((s) => !used.has(s.id) && s.movie_id === e.movie.id && businessDate(same(s.starts_at)) === e.date);
  if (hit) {
    used.add(hit.id);
    e.matched = hit;
    const what = [];
    if (hit.room_id !== e.room.id) what.push(`room ${roomName(hit.room_id)} -> ${e.where}`);
    if (same(hit.starts_at) !== same(e.starts_at)) what.push(`time ${clock(hit.starts_at)} -> ${clock(e.starts_at)}`);
    if ((hit.visibility ?? "private") !== e.visibility) what.push(`visibility ${hit.visibility} -> ${e.visibility}`);
    toChange.push({ e, s: hit, what, flag: held[hit.id] && what.some((w) => !w.startsWith("visibility")) ? held[hit.id] : 0 });
  } else toAdd.push(e);
}
// A showing the calendar still names in a line it otherwise skips ("Zoe
// request Over the Garden Wall" at 8 PM) stays: someone booked it on purpose.
const kept = [];
for (const k of skipped) {
  if (!k.start || !k.room) continue;
  const at = Date.parse(centralToIso(k.start[0] < 4 ? addDays(k.date, 1) : k.date, k.start));
  const hit = dbRows.find((s) => !used.has(s.id) && s.room_id === k.room.id && same(s.starts_at) === at && s.movie?.title && norm(k.text).includes(norm(s.movie.title)));
  if (!hit) continue;
  used.add(hit.id);
  kept.push({ date: k.date, starts_at: hit.starts_at, title: hit.movie.title, text: k.text });
}
// 3) on the schedule but not on the calendar (only through the calendar's last date).
const toRemove = dbRows
  .filter((s) => !used.has(s.id) && businessDate(same(s.starts_at)) <= lastDate)
  .map((s) => ({ s, sold: held[s.id] ?? 0 }));

// ---------- report ----------
const VIS = { public: "", members: " [Members only]", private: " [Private]" };
const lines = [];
const say = (s = "") => lines.push(s);
const dayHead = (date) => `${dayName(date)} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
function grouped(title, items, fmt) {
  say(`${title} (${items.length})`);
  say("-".repeat(title.length + String(items.length).length + 3));
  if (!items.length) say("  nothing");
  let last = null;
  for (const it of items) {
    if (it.date !== last) {
      say(dayHead(it.date));
      last = it.date;
    }
    say(`    ${fmt(it)}`);
  }
  say();
}
say(`Calendar sync ${apply ? "" : "DRY RUN "}from ${dayHead(today)} through ${dayHead(lastDate)} (OCT/NOV/DEC tabs; "Copy of" tabs ignored)`);
say(apply ? "" : "Nothing was written. Run again with --apply to make these changes.");
say();
say(`Summary: ${toAdd.length} to add, ${toChange.length} to change, ${toRemove.length} to remove (${toRemove.filter((r) => r.sold).length} flagged: tickets sold), ${skipped.length} calendar lines skipped, ${needs.size} titles need adding.`);
say();
const sortT = (a, b) => same(a.starts_at) - same(b.starts_at);
grouped(
  "TO ADD",
  toAdd.map((e) => ({ ...e, starts_at: e.starts_at })).sort(sortT),
  (e) => `${clock(e.starts_at)}  ${e.title}${e.where === "outdoor" ? " (outdoor)" : ""}${VIS[e.visibility]}${e.movie ? "" : "   << needs adding: no movie record"}`,
);
grouped(
  "TO CHANGE",
  toChange.map((c) => ({ ...c, date: c.e.date, starts_at: c.e.starts_at })).sort(sortT),
  (c) => `${clock(c.e.starts_at)}  ${c.e.title}${c.e.where === "outdoor" ? " (outdoor)" : ""}: ${c.what.join(", ")}${c.flag ? `   << FLAG: ${c.flag} tickets sold, not moved` : ""}`,
);
grouped(
  "TO REMOVE",
  toRemove.map((r) => ({ ...r, date: businessDate(same(r.s.starts_at)), starts_at: r.s.starts_at })).sort(sortT),
  (r) => `${clock(r.s.starts_at)}  ${r.s.movie?.title ?? "?"}${r.s.room_id === outdoorRoom.id ? " (outdoor)" : ""}${VIS[r.s.visibility] ?? ""}${r.sold ? `   << FLAG: ${r.sold} tickets sold, NOT removed` : ""}`,
);
grouped("KEPT (on the calendar as a note, already scheduled)", kept, (k) => `${clock(k.starts_at)}  ${k.title}   (calendar: "${k.text}")`);
say(`NEEDS ADDING (no movie record yet; add in Back office, then run again)`);
for (const { title: t, n } of needs.values()) say(`    needs adding: ${t}  (${n} showing${n === 1 ? "" : "s"})`);
if (imported.length) {
  say();
  say(apply ? "FILMS ADDED from TMDb" : "FILMS TMDb would add (--apply adds them)");
  for (const m of imported) say(`    ${m.asked} -> ${m.title} (${m.year ?? "?"})`);
}
for (const t of notFound) say(`    not found on TMDb: ${t}`);
if (!needs.size) say("    nothing");
say();
grouped("SKIPPED calendar lines", skipped, (s) => `${s.time ? `${s.time}  ` : ""}${s.text}   (${s.why})`);
say(`Also ignored: ${blanks} empty time slots with no title.`);
const report = lines.join("\n");
console.log(report);
if (outFile) writeFileSync(outFile, report + "\n");

if (apply) {
  const add = toAdd.filter((e) => e.movie);
  if (add.length) {
    const { error } = await db.from("screenings").insert(
      add.map((e) => ({
        movie_id: e.movie.id,
        room_id: e.room.id,
        starts_at: e.starts_at,
        ticket_price: e.room === outdoorRoom ? 0 : 8,
        capacity: e.room.capacity,
        visibility: e.visibility,
      })),
    );
    if (error) throw error;
  }
  for (const c of toChange) {
    const patch = { visibility: c.e.visibility };
    if (!c.flag) Object.assign(patch, { room_id: c.e.room.id, starts_at: c.e.starts_at });
    const { error } = await db.from("screenings").update(patch).eq("id", c.s.id);
    if (error) throw error;
  }
  const gone = toRemove.filter((r) => !r.sold).map((r) => r.s.id);
  if (gone.length) {
    const { error } = await db.from("screenings").delete().in("id", gone);
    if (error) throw error;
  }
  console.log(`\nWrote ${add.length} adds, ${toChange.length} changes, ${gone.length} removals. The website picks them up within a minute.`);
}
