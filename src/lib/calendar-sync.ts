// Syncing the schedule with the staff calendar, "RCL Calendar 2026.xlsx"
// (Caleb keeps it in Google Drive). Shared by Back office > Showtimes >
// Sync from calendar (src/app/admin/screenings/sync) and
// scripts/sync-calendar.mjs, so both read the sheet and decide the same way.
//
// The sheet: one tab per month ("OCT", "NOV"... or "OCT CALENDAR"; "Copy
// of..." and template tabs are ignored). Columns: DATE, DAY, TIME, MOVIE
// TITLE, SOURCE, then the outdoor screen's [TIME,] MOVIE TITLE, SOURCE,
// NOTES... A row with no date belongs to the date above. Only dates from
// today's business night on are read (the business day runs 4 AM to 4 AM
// Central, so "12AM" belongs to the night before).
//
// Rules:
//   - Outdoor-column titles go on the outdoor screen, Members only, $0.
//   - Wednesday 8 PM indoors is Midweek Movies: Members only, $5.
//   - "(do not include on website)", "Private ...", "Private Rental/Event/
//     Screening <TITLE> - name" -> Private (the film's title is kept).
//   - Everything else is Public, $8 (older titles stay hidden by the MPLC rule).
//   - Trivia, comedy, open mic, book swap, CLOSED, premieres, requests and
//     the like are skipped and listed, never silently dropped.
//
// The calendar wins: from today on, a showing's room, time, visibility and
// price follow the calendar, even if someone changed them in Back office.
// A showing the calendar doesn't have is removed, unless tickets are sold
// for it (then it's flagged). A showing with tickets sold is never moved
// either; it's flagged so staff can move it and tell the ticket holders.
//
// No server-only imports: plain node scripts load this file too.
import type { SupabaseClient } from "@supabase/supabase-js";
import readXlsxFile from "read-excel-file/node";
import { isOutdoorRoom, parseShowingTitle, type ShowingVisibility } from "@/lib/showing-visibility";

// ---------- dates and times (Central) ----------
const TZ = "America/Chicago";
type Clock = [number, number];

function centralHour(ms: number) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
}
export function centralIso(date: string, [h, m]: Clock): string {
  let t = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`) + 5 * 3_600_000;
  const got = centralHour(t);
  if (got !== h) t += (h - got) * 3_600_000;
  return new Date(t).toISOString();
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const centralDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
// The business night a moment belongs to: 4 AM to 4 AM Central.
export const businessDate = (ms: number) => (centralHour(ms) < 4 ? addDays(centralDate(ms), -1) : centralDate(ms));
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayName = (date: string) => DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
// "Fri 10/23"
export const dayHead = (date: string) => `${dayName(date)} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
// "8 PM", "6:30 PM"
export function clockOf(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "").replace(/\s/, " ");
}

function parseClock(s: string, fallbackAp?: string): Clock | null {
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
function parseStart(s: string): Clock | null {
  const [a, b] = clean(s).split(/\s*-\s*/);
  if (!a) return null;
  const endAp = b ? /([ap])\.?m/i.exec(b)?.[1] : undefined;
  return parseClock(a, /[ap]\.?m/i.test(a) ? undefined : endAp);
}

// ---------- reading the workbook ----------
export type Cell = string | number | boolean | Date | null | undefined | unknown;
export interface CalendarTab {
  sheet: string;
  data: Cell[][];
}

export async function readCalendarFile(input: Buffer | string): Promise<CalendarTab[]> {
  const sheets = await readXlsxFile(input);
  return sheets.map((s) => ({ sheet: s.sheet, data: s.data as Cell[][] }));
}

const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/\\/g, "")
    .replace(/[￼ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A time typed as a time ("8:00 PM" formatted) comes back as a date on
// 12/30/1899, or as a fraction of a day.
function cellText(c: Cell): string {
  if (c instanceof Date) {
    if (c.getUTCFullYear() < 1901) {
      const h = c.getUTCHours();
      return `${h % 12 || 12}:${String(c.getUTCMinutes()).padStart(2, "0")}${h < 12 ? "AM" : "PM"}`;
    }
    return c.toISOString().slice(0, 10);
  }
  if (typeof c === "number" && c > 0 && c < 1) {
    const mins = Math.round(c * 1440);
    const h = Math.floor(mins / 60);
    return `${h % 12 || 12}:${String(mins % 60).padStart(2, "0")}${h < 12 ? "AM" : "PM"}`;
  }
  return clean(c);
}
function cellDate(c: Cell): string | null {
  if (c instanceof Date && c.getUTCFullYear() > 1900) return c.toISOString().slice(0, 10);
  if (typeof c === "number" && c > 20000 && c < 80000) return new Date(Date.UTC(1899, 11, 30) + c * 86_400_000).toISOString().slice(0, 10);
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(c));
  if (d) return `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(c));
  return iso ? iso[0] : null;
}

const MONTH_TAB = /^(JAN|FEB|MAR|APR|MAY|JUNE?|JULY?|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*( CALENDAR)?$/i;

// ---------- what a cell says ----------
const SKIP: [RegExp, string][] = [
  [/\btrivia\b/i, "trivia"],
  [/\bcomedy\b/i, "comedy"],
  [/open mic/i, "open mic"],
  [/book swap/i, "book swap"],
  [/^closed$/i, "closed"],
  [/\bno (movie|showing|film)\b/i, "no movie"],
  [/arc (of the )?ozarks/i, "Arc of the Ozarks screening, no title"],
  [/premiere event/i, "premiere event"],
  [/filmmaker/i, "filmmaker screening"],
  [/^midweek movies$/i, "Midweek Movies with no title yet"],
  [/\brequest\b/i, "a request, not a booked title"],
  [/football|super ?bowl/i, "not a movie"],
  [/\bevent$/i, "an event, no film named"],
];
const STATUS = /^(CONFIRMED|TENTATIVE|ENTIRE|BUILDING|WEST|HALL|ONLY|OWES|FULL|BALANCE)$/;
const DO_NOT = /\(?\s*do\s*n[o']?t\s+(include|list)[^)]*\)?/i;

type ReadTitle = { skip: string | null } | { title: string; year: number | null; visibility: ShowingVisibility };

export function readTitle(raw: string): ReadTitle {
  let t = clean(raw);
  if (!t) return { skip: null };
  for (const [re, why] of SKIP) if (re.test(t)) return { skip: why };
  let visibility: ShowingVisibility = "public";
  if (DO_NOT.test(t)) {
    visibility = "private";
    t = t.replace(DO_NOT, "").trim();
  }
  const priv = /^\(?\s*private\s*(rental|screening|event)?\b\s*[-:]?\s*/i.exec(t);
  if (priv) {
    visibility = "private";
    // The sheet writes the film in capitals: "Private Rental GHOSTBUSTERS
    // 1984 - Entire Building - Mandy Woods". No capitals, no film named.
    const words: string[] = [];
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
  let year: number | null = null;
  const y = /\s(19\d\d|20\d\d)$/.exec(t);
  if (y) {
    year = Number(y[1]);
    t = t.slice(0, y.index).trim();
  }
  // "GHOSTBUSTERS" -> "Ghostbusters", "BEETLEJUICE 2" -> "Beetlejuice 2".
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());
  return { title: t, year, visibility };
}

// ---------- the calendar ----------
export type Where = "indoor" | "outdoor";

export interface CalEntry {
  date: string; // business night, YYYY-MM-DD
  where: Where;
  startsAt: string; // ISO
  time: string; // as written
  title: string;
  year: number | null;
  visibility: ShowingVisibility;
  raw: string; // the cell as written
  odd: string | null; // why the time looks odd, if it does
}

export interface CalSkip {
  date: string;
  time: string;
  text: string;
  why: string;
  where?: Where;
  startsAt?: string;
}

export interface ParsedCalendar {
  today: string;
  lastDate: string; // the last dated row on the calendar
  tabs: string[];
  entries: CalEntry[];
  skipped: CalSkip[];
}

export function parseCalendar(tabs: CalendarTab[], now = Date.now()): ParsedCalendar {
  const today = businessDate(now);
  const entries: CalEntry[] = [];
  const skipped: CalSkip[] = [];
  const read: string[] = [];
  let lastDate = today;
  for (const tab of tabs) {
    const name = clean(tab.sheet);
    if (/copy of|template/i.test(name) || !MONTH_TAB.test(name)) continue;
    const hi = tab.data.findIndex((r) => clean(r[0]).toUpperCase() === "DATE");
    if (hi < 0) continue;
    const header = tab.data[hi].map((h) => clean(h).toUpperCase());
    const titleCols = header.map((h, i) => (/MOVIE TITLE/.test(h) ? i : -1)).filter((i) => i >= 0);
    const [inTitle, outTitle = -1] = titleCols;
    const inTime = header.indexOf("TIME");
    const outTime = outTitle > inTitle + 1 && header[outTitle - 1] === "TIME" ? outTitle - 1 : -1;
    let date: string | null = null;
    for (const r of tab.data.slice(hi + 1)) {
      const d = cellDate(r[0]);
      if (d) date = d;
      if (!date || date < today) continue;
      if (date > lastDate) lastDate = date;
      if (!read.includes(name)) read.push(name);
      const rowTime = cellText(r[inTime]);
      const slots: { where: Where; time: string; title: string; ownTime: boolean }[] = [{ where: "indoor", time: rowTime, title: cellText(r[inTitle]), ownTime: true }];
      if (outTitle >= 0) {
        const own = outTime >= 0 ? cellText(r[outTime]) : "";
        slots.push({ where: "outdoor", time: own || rowTime, title: cellText(r[outTitle]), ownTime: !!own });
      }
      for (const s of slots) {
        const start = parseStart(s.time);
        if (!s.title) {
          // "CLOSED" or "FLANAGAN/INDI EVENT" written in the time column.
          if (s.where === "indoor" && s.time && !start) {
            const r2 = readTitle(s.time);
            skipped.push({ date, time: "", text: s.time, why: "skip" in r2 ? (r2.skip ?? "not a time") : "not a time" });
          }
          continue;
        }
        const label = `${s.title}${s.where === "outdoor" ? " (outdoor)" : ""}`;
        const t = readTitle(s.title);
        const at = start ? centralIso(start[0] < 4 ? addDays(date, 1) : date, start) : undefined;
        if ("skip" in t) {
          skipped.push({ date, time: s.time, text: label, why: t.skip ?? "blank", where: s.where, startsAt: at });
          continue;
        }
        if (!start || !at) {
          skipped.push({ date, time: s.time, text: label, why: s.time ? `can't read the time "${s.time}"` : "no time given" });
          continue;
        }
        let odd: string | null = null;
        if (start[0] >= 2 && start[0] < 10) odd = `starts at ${clockOf(at)}`;
        else if (start[1] % 15) odd = `starts at ${clockOf(at)}`;
        else if (!s.ownTime && s.where === "outdoor") odd = "the outdoor column has no time, so the row's time was used";
        let visibility = t.visibility;
        if (visibility !== "private" && s.where === "outdoor") visibility = "members";
        if (visibility !== "private" && s.where === "indoor" && dayName(date) === "Wed" && start[0] === 20 && start[1] === 0) visibility = "members";
        entries.push({ date, where: s.where, startsAt: at, time: s.time, title: t.title, year: t.year, visibility, raw: s.title, odd });
      }
    }
  }
  return { today, lastDate, tabs: read, entries, skipped };
}

// ---------- matching titles to movies ----------
const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6" };
export function norm(s: string) {
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
function variants(title: string) {
  const n = norm(title);
  return new Set([n, n.replace(/ part (\d)$/, " $1"), n.replace(/ and /g, " ")]);
}

export interface SyncMovie {
  id: string;
  title: string;
  release_year: number | null;
}

// Every movie the title could be. Several ("Legend") is for staff to pick.
export function movieCandidates(title: string, year: number | null, movies: SyncMovie[]): SyncMovie[] {
  const want = variants(title);
  let found = movies.filter((m) => want.has(norm(m.title)) || want.has(norm(m.title).replace(/ and /g, " ")));
  if (!found.length) found = movies.filter((m) => want.has(norm(m.title.split(":")[0])));
  if (found.length > 1 && year) {
    const y = found.filter((m) => m.release_year === year);
    if (y.length) found = y;
  }
  return [...found].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0));
}

// One choice per title (and year, if the sheet gave one) covers all its showings.
export const titleKey = (title: string, year: number | null) => `${norm(title)}${year ? `|${year}` : ""}`;

// ---------- the database ----------
export interface SyncRoom {
  id: string;
  key: string | null;
  name: string | null;
  capacity: number;
}
export interface DbShowing {
  id: string;
  starts_at: string;
  room_id: string;
  movie_id: string;
  visibility: string | null;
  ticket_price: number;
  capacity: number;
  title: string;
}
export interface SyncState {
  now: number;
  movies: SyncMovie[];
  indoor: SyncRoom;
  outdoor: SyncRoom;
  showings: DbShowing[]; // from now on, indoor and outdoor screens
  held: Record<string, number>; // tickets sold or being paid for, per showing
}

export async function loadSyncState(db: SupabaseClient, now = Date.now()): Promise<SyncState> {
  const [m, r] = await Promise.all([db.from("movies").select("id, title, release_year"), db.from("rooms").select("id, key, name, capacity, is_screening_room")]);
  if (m.error) throw m.error;
  if (r.error) throw r.error;
  const rooms = (r.data ?? []) as (SyncRoom & { is_screening_room: boolean })[];
  const outdoor = rooms.find((x) => isOutdoorRoom(x));
  const indoor = rooms.find((x) => x.is_screening_room && !isOutdoorRoom(x));
  if (!outdoor || !indoor) throw new Error("The indoor and outdoor screening rooms aren't both set up.");
  const s = await db
    .from("screenings")
    .select("id, starts_at, room_id, movie_id, visibility, ticket_price, capacity, movie:movies(title)")
    .gte("starts_at", new Date(now).toISOString())
    .in("room_id", [indoor.id, outdoor.id])
    .order("starts_at")
    .limit(2000);
  if (s.error) throw s.error;
  const showings = (s.data ?? []).map((x) => {
    const mv = x.movie as unknown as { title: string } | { title: string }[] | null;
    return { ...(x as unknown as DbShowing), ticket_price: Number(x.ticket_price), title: (Array.isArray(mv) ? mv[0]?.title : mv?.title) ?? "?" };
  });
  // Held, as the database's own delete check counts it: confirmed, or a
  // checkout from the last 35 minutes.
  const held: Record<string, number> = {};
  const payingSince = now - 35 * 60_000;
  for (let i = 0; i < showings.length; i += 50) {
    const ids = showings.slice(i, i + 50).map((x) => x.id);
    const b = await db.from("bookings").select("screening_id, quantity, status, created_at").in("screening_id", ids).in("status", ["confirmed", "pending"]);
    if (b.error) throw b.error;
    for (const k of b.data ?? []) {
      if (k.status === "pending" && Date.parse(k.created_at as string) < payingSince) continue;
      held[k.screening_id as string] = (held[k.screening_id as string] ?? 0) + (k.quantity as number);
    }
  }
  return { now, movies: (m.data ?? []) as SyncMovie[], indoor, outdoor, showings, held };
}

// ---------- the plan ----------
// What a ticket costs, by the calendar's rules.
export function priceFor(where: Where, visibility: ShowingVisibility) {
  return where === "outdoor" ? 0 : visibility === "members" ? 5 : 8;
}

// A staff choice for a title: a movie's id, "tmdb:<id>" (add it from
// TMDb first), or "skip".
export type Picks = Record<string, string>;

export interface Candidate {
  value: string; // movie id or "tmdb:<id>"
  label: string; // "Legend (1985)"
  source: "library" | "tmdb";
}

export interface Look {
  key: string;
  kind: "unmatched" | "ambiguous";
  title: string;
  year: number | null;
  when: string[]; // "Fri 10/23 8 PM"
  candidates: Candidate[];
  picked: string | null;
}

export interface Line {
  date: string;
  startsAt: string;
  clock: string;
  title: string;
  where: Where;
  detail: string;
}

export interface PlanAdd extends Line {
  movieId: string; // a movie id, or "tmdb:<id>" until it's added
  roomId: string;
  visibility: ShowingVisibility;
  price: number;
  capacity: number;
}
export interface PlanChange extends Line {
  id: string;
  patch: { room_id?: string; starts_at?: string; visibility?: ShowingVisibility; ticket_price?: number; capacity?: number };
}
export interface PlanRemove extends Line {
  id: string;
}

export interface SyncPlan {
  today: string;
  lastDate: string;
  tabs: string[];
  add: PlanAdd[];
  change: PlanChange[];
  remove: PlanRemove[];
  // Needs a look: titles to pick, showings with tickets that weren't
  // moved or removed, odd times, and every line skipped as not a movie.
  looks: Look[];
  flagged: Line[];
  odd: Line[];
  skipped: Line[];
  kept: Line[];
  signature: string;
}

const VIS_WORD: Record<ShowingVisibility, string> = { public: "Public", members: "Members only", private: "Private" };
const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;
const tix = (n: number) => `${n} ticket${n === 1 ? "" : "s"}`;

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function buildPlan(cal: ParsedCalendar, state: SyncState, picks: Picks = {}, tmdbCandidates: Record<string, Candidate[]> = {}): SyncPlan {
  const { indoor, outdoor, now, held } = state;
  const roomOf = (w: Where) => (w === "outdoor" ? outdoor : indoor);
  const whereOf = (roomId: string): Where => (roomId === outdoor.id ? "outdoor" : "indoor");
  const line = (date: string, startsAt: string, title: string, where: Where, detail = ""): Line => ({ date, startsAt, clock: clockOf(startsAt), title, where, detail });
  const at = Date.parse;

  const add: PlanAdd[] = [];
  const change: PlanChange[] = [];
  const flagged: Line[] = [];
  const odd: Line[] = [];
  const kept: Line[] = [];
  const looks = new Map<string, Look>();
  const used = new Set<string>();
  const protectSlots: { roomId: string; at: number; text: string; any: boolean }[] = [];

  // Upcoming only: a showing earlier tonight has already played.
  const entries = cal.entries.filter((e) => at(e.startsAt) > now);
  const shows = state.showings;

  // Which movie each line is.
  const tmdbTitle = (v: string) => Object.values(tmdbCandidates).flat().find((c) => c.value === v)?.label ?? "a film from TMDb";
  type Resolved = CalEntry & { movieId: string | null; movieTitle: string };
  const slotSeen = new Set<string>();
  const resolved: Resolved[] = [];
  for (const e of entries) {
    const room = roomOf(e.where);
    const slot = `${room.id} ${at(e.startsAt)}`;
    if (slotSeen.has(slot)) {
      odd.push(line(e.date, e.startsAt, e.title, e.where, "a second film on the same screen at the same time: not added"));
      continue;
    }
    slotSeen.add(slot);
    if (e.odd) odd.push(line(e.date, e.startsAt, e.title, e.where, e.odd));
    const key = titleKey(e.title, e.year);
    const cands = movieCandidates(e.title, e.year, state.movies);
    const pick = picks[key];
    let movieId: string | null = null;
    let movieTitle = e.title;
    if (pick && pick !== "skip") {
      movieId = pick;
      movieTitle = state.movies.find((m) => m.id === pick)?.title ?? (pick.startsWith("tmdb:") ? tmdbTitle(pick).replace(/ \(\d{4}\)$/, "") : e.title);
    } else if (!pick && cands.length === 1) {
      movieId = cands[0].id;
      movieTitle = cands[0].title;
    } else if (!pick && cands.length > 1) {
      // Picked before: a showing that night already has one of them.
      const prior = shows.find((s) => cands.some((c) => c.id === s.movie_id) && businessDate(at(s.starts_at)) === e.date);
      if (prior) {
        movieId = prior.movie_id;
        movieTitle = prior.title;
      }
    }
    // Any title that isn't a single sure match is listed, picked or not,
    // so the choice can be seen and changed.
    if (pick || cands.length !== 1) {
      const lk = looks.get(key) ?? {
        key,
        kind: cands.length > 1 ? ("ambiguous" as const) : ("unmatched" as const),
        title: e.title,
        year: e.year,
        when: [],
        candidates: [
          ...cands.map((c) => ({ value: c.id, label: `${c.title}${c.release_year ? ` (${c.release_year})` : ""}`, source: "library" as const })),
          ...(tmdbCandidates[key] ?? []),
        ],
        picked: pick ?? movieId,
      };
      lk.when.push(`${dayHead(e.date)} ${clockOf(e.startsAt)}${e.where === "outdoor" ? " outdoor" : ""}`);
      looks.set(key, lk);
    }
    if (movieId) {
      resolved.push({ ...e, movieId, movieTitle });
    } else {
      // Not decided: whatever is on the schedule in that slot stays for now.
      protectSlots.push({ roomId: room.id, at: at(e.startsAt), text: e.title, any: true });
    }
  }

  // 1) same movie, same screen, same time; 2) same movie, same night.
  const matched = new Map<Resolved, DbShowing>();
  for (const e of resolved) {
    const s = shows.find((x) => !used.has(x.id) && x.movie_id === e.movieId && x.room_id === roomOf(e.where).id && at(x.starts_at) === at(e.startsAt));
    if (s) {
      used.add(s.id);
      matched.set(e, s);
    }
  }
  for (const e of resolved) {
    if (matched.has(e)) continue;
    const same = shows
      .filter((x) => !used.has(x.id) && x.movie_id === e.movieId && businessDate(at(x.starts_at)) === e.date)
      .sort((a, b) => Math.abs(at(a.starts_at) - at(e.startsAt)) - Math.abs(at(b.starts_at) - at(e.startsAt)))[0];
    if (same) {
      used.add(same.id);
      matched.set(e, same);
    }
  }

  for (const e of resolved) {
    const room = roomOf(e.where);
    const price = priceFor(e.where, e.visibility);
    const s = matched.get(e);
    if (!s) {
      add.push({
        ...line(e.date, e.startsAt, e.movieTitle, e.where, `${VIS_WORD[e.visibility]}, ${money(price)}${e.movieId?.startsWith("tmdb:") ? ", adds the film from TMDb" : ""}`),
        movieId: e.movieId!,
        roomId: room.id,
        visibility: e.visibility,
        price,
        capacity: room.capacity,
      });
      continue;
    }
    const sold = held[s.id] ?? 0;
    const patch: PlanChange["patch"] = {};
    const what: string[] = [];
    const moves = s.room_id !== room.id || at(s.starts_at) !== at(e.startsAt);
    if (moves && sold) {
      // Left exactly as it is: its price and visibility go with the move.
      flagged.push(line(e.date, s.starts_at, s.title, whereOf(s.room_id), `${tix(sold)} sold, so it wasn't changed. The calendar has it ${e.where} at ${clockOf(e.startsAt)}: move it with Edit and let the ticket holders know.`));
      continue;
    }
    if (s.room_id !== room.id) {
      patch.room_id = room.id;
      patch.capacity = room.capacity;
      what.push(`${whereOf(s.room_id)} → ${e.where}`);
    }
    if (at(s.starts_at) !== at(e.startsAt)) {
      patch.starts_at = e.startsAt;
      what.push(`${clockOf(s.starts_at)} → ${clockOf(e.startsAt)}`);
    }
    if ((s.visibility ?? "private") !== e.visibility) {
      patch.visibility = e.visibility;
      what.push(`${VIS_WORD[(s.visibility as ShowingVisibility) ?? "private"] ?? s.visibility} → ${VIS_WORD[e.visibility]}`);
    }
    if (Number(s.ticket_price) !== price) {
      patch.ticket_price = price;
      what.push(`${money(Number(s.ticket_price))} → ${money(price)}`);
    }
    if (what.length) change.push({ ...line(e.date, e.startsAt, s.title, e.where, what.join(", ")), id: s.id, patch });
  }

  // A showing the calendar still names in a line it otherwise skips ("Zoe
  // request Over the Garden Wall" at 8 PM) stays: someone booked it on purpose.
  for (const k of cal.skipped) if (k.startsAt && k.where) protectSlots.push({ roomId: roomOf(k.where).id, at: at(k.startsAt), text: k.text, any: false });
  for (const p of protectSlots) {
    const s = shows.find((x) => !used.has(x.id) && x.room_id === p.roomId && at(x.starts_at) === p.at && (p.any || norm(p.text).includes(norm(x.title))));
    if (!s) continue;
    used.add(s.id);
    kept.push(line(businessDate(at(s.starts_at)), s.starts_at, s.title, whereOf(s.room_id), p.any ? `kept until "${p.text}" is sorted out above` : `the calendar says "${p.text}"`));
  }

  // 3) on the schedule but not on the calendar, through its last date.
  const remove: PlanRemove[] = [];
  for (const s of shows) {
    if (used.has(s.id)) continue;
    const d = businessDate(at(s.starts_at));
    if (d > cal.lastDate) continue;
    const sold = held[s.id] ?? 0;
    const l = line(d, s.starts_at, s.title, whereOf(s.room_id));
    if (sold) flagged.push({ ...l, detail: `not on the calendar, but ${tix(sold)} sold, so it wasn't removed. Refund or move it, or put it back on the calendar.` });
    else remove.push({ ...l, id: s.id });
  }

  const skipped = cal.skipped
    .filter((k) => !k.startsAt || at(k.startsAt) > now)
    .map((k) => ({ date: k.date, startsAt: k.startsAt ?? centralIso(k.date, [12, 0]), clock: k.time, title: k.text, where: k.where ?? ("indoor" as Where), detail: k.why }));

  const byTime = (a: Line, b: Line) => a.date.localeCompare(b.date) || at(a.startsAt) - at(b.startsAt);
  [add, change, remove, flagged, odd, kept].forEach((l) => (l as Line[]).sort(byTime));
  const signature = hash(
    JSON.stringify([add.map((a) => [a.movieId, a.roomId, a.startsAt, a.visibility, a.price]), change.map((c) => [c.id, c.patch]), remove.map((r) => r.id)]),
  );
  return { today: cal.today, lastDate: cal.lastDate, tabs: cal.tabs, add, change, remove, looks: [...looks.values()], flagged, odd, skipped, kept, signature };
}

// ---------- writing it ----------
// One database call (apply_calendar_sync, migration
// 20261007010000_calendar_syncs.sql): removals, changes and adds all land
// or none do, and the sync is logged with who ran it. `movieIds` maps any
// "tmdb:<id>" left in the plan to the movie now added for it.
export async function applyPlan(
  db: SupabaseClient,
  plan: SyncPlan,
  who: { id: string | null; name: string; file: string | null },
  movieIds: Record<string, string> = {},
) {
  const adds = plan.add
    .map((a) => ({ movie_id: movieIds[a.movieId] ?? a.movieId, room_id: a.roomId, starts_at: a.startsAt, visibility: a.visibility, ticket_price: a.price, capacity: a.capacity }))
    .filter((a) => !a.movie_id.startsWith("tmdb:"));
  const { data, error } = await db.rpc("apply_calendar_sync", {
    p_adds: adds,
    p_changes: plan.change.map((c) => ({ id: c.id, ...c.patch })),
    p_removes: plan.remove.map((r) => r.id),
    p_by: who.id,
    p_by_name: who.name,
    p_file: who.file,
    p_summary: { flagged: plan.flagged.length, looks: plan.looks.length, skipped: plan.skipped.length, through: plan.lastDate },
  });
  if (error) throw error;
  return data as { added: number; changed: number; removed: number; kept: number };
}
