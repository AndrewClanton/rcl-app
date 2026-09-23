import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The weekly flyer -- one phone-first canvas that goes out by email and DM.
//
// Film-first, not day-first: a week here is ~6 titles each showing 2-5
// times, so "poster / title / when" per film is both far more compact than a
// 7-column calendar and closer to how someone actually reads a lineup
// ("when can I catch Hope?"). Days that carry something other than a
// screening (closed, a private booking, a note) are collected into one
// short "also this week" block underneath.
//
// Sized so the finished image still reads at email width (~600px) or on a
// phone: big titles, mono times, posters at real size, on an ink ground
// that makes the poster art the brightest thing on the page. Height flexes
// with the week (4:5 for a light one, up to ~1:2.2 for a packed one). Rather
// than shrinking everything uniformly or cutting films, the week gets the
// largest of three size tiers that fits; only past the smallest tier do
// films drop off with a "+N more" line.
//
// Members' edition: older titles (which our MPLC license lets us tell
// members about but not advertise) go in their own "film archive" section
// as compact two-up cards, so a packed week still fits with nothing hidden.
//
// Pure module -- no Next/Supabase imports -- so it can be rendered from a
// fixture without a staff login (scripts/preview-schedule-graphic.mjs).
// Colors are the site's own tokens (globals.css) as literal hex, since
// Satori renders in total isolation from the app's CSS.

const CREAM = "#f8f5ec";
const SURFACE = "#ffffff";
export const INK = "#14110c";
const INK_CARD = "#211d16";
const INK_RULE = "#3a342b";
const ON_INK_MUTED = "#a9a293";
const ON_INK_SOFT = "#d9d3c4";
const ACCENT = "#ed1c24";
const GOLD = "#ffc72c";
export const QR_DARK = INK;
export const QR_LIGHT = SURFACE;

const DISPLAY = "Archivo Black";
const SANS = "Archivo";
const MONO = "Space Mono";

const CENTRAL_TZ = "America/Chicago";

export const FLYER_W = 1080;
const PAD = 40;
const MIN_H = 1350; // 4:5 -- a light week still fills a phone screen
const MAX_H = 2600; // ~1:2.4 -- past this, films get cut with a "+N more"
const MASTHEAD_H = 196;
const MEMBERS_STRIP_H = 44;
const FOOTER_H = 176;
const NOTE_STRIP_H = 66;
const POSTER_SHADOW = 6;
const CHIP_PAD_X = 14;
const CHIP_GAP = 10;
const DISPLAY_EM = 0.6; // Archivo Black average advance, as a fraction of font size
const MONO_EM = 0.62; // Space Mono advance width
const ALSO_HEADER_LINE = 30;
const ALSO_LINE = 42;
const ALSO_PAD_Y = 22;
const ALSO_MAX_CHARS = 58;
const MORE_LINE_H = 64;
const ARCHIVE_HEADER_H = 58;
const ARCHIVE_PAD = 16;
const ARCHIVE_CARD_W = (FLYER_W - PAD * 2 - ARCHIVE_PAD) / 2;
const ARCHIVE_CARD_PAD = 12;
const ARCHIVE_POSTER_W = 96;
const ARCHIVE_POSTER_H = 144;
const ARCHIVE_TITLE = 28;
const ARCHIVE_TITLE_LINE = 32;
const ARCHIVE_CHIP = 21;
const ARCHIVE_CHIP_H = 38;
const ARCHIVE_TEXT_W = ARCHIVE_CARD_W - ARCHIVE_CARD_PAD * 2 - ARCHIVE_POSTER_W - 14;

// Largest first; fitFlyer picks the first that fits the height cap.
interface Tier {
  poster: number;
  posterH: number;
  title: number;
  titleLine: number;
  meta: number;
  chip: number;
  chipH: number;
  padY: number;
  gap: number;
}
const TIERS: Tier[] = [
  { poster: 160, posterH: 240, title: 54, titleLine: 58, meta: 22, chip: 28, chipH: 54, padY: 18, gap: 28 },
  { poster: 130, posterH: 195, title: 46, titleLine: 50, meta: 21, chip: 26, chipH: 50, padY: 16, gap: 24 },
  { poster: 104, posterH: 156, title: 40, titleLine: 44, meta: 20, chip: 24, chipH: 46, padY: 14, gap: 20 },
];

// ---- Input rows (what the route hands over from the DB) --------------------

export interface ScreeningRow {
  id: string;
  starts_at: string;
  movie: {
    title: string;
    poster_url: string | null;
    runtime_minutes: number | null;
    rating: string | null;
    archive?: boolean; // an older title our license lets us tell members about, but not advertise
  } | null;
  room: { name: string } | null;
}
export interface EventRow {
  id: string;
  event_name: string;
  event_date: string; // YYYY-MM-DD
  event_time: string; // HH:MM:SS wall clock
  hours: number;
  room: { name: string } | null;
}
export interface NoteRow {
  id: string;
  note_date: string;
  start_time: string | null;
  end_time: string | null;
  label: string;
}

// ---- Model -----------------------------------------------------------------

interface FilmChip {
  dateKey: string;
  day: string; // "WED" (or "WED 9/23" when the range runs past a week)
  times: { label: string; minutes: number }[];
  outdoor: boolean;
}
export interface FilmBlock {
  title: string;
  posterUrl: string | null;
  rating: string | null;
  runtimeMinutes: number | null;
  chips: FilmChip[];
  firstAt: number;
}
export interface AlsoLine {
  kind: "closed" | "event" | "note";
  text: string;
}
export interface FlyerModel {
  films: FilmBlock[];
  archive: FilmBlock[];
  also: AlsoLine[];
}

function isOutdoor(roomName: string | null | undefined) {
  return !!roomName && roomName.toLowerCase().includes("outdoor");
}

function centralDateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function addDaysToKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(dateKey: string, withDate: boolean) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }).toUpperCase();
  return withDate ? `${weekday} ${m}/${d}` : weekday;
}

// "11:00 AM" -> "11AM", "9:30 PM" -> "9:30PM" -- drops the noise a poster
// doesn't need.
function shortTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CENTRAL_TZ, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  const dp = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  return m === "00" ? `${h}${dp}` : `${h}:${m}${dp}`;
}

// hourCycle "h23" avoids the Intl quirk where hour12:false alone can format
// midnight as "24:00" in some engines.
function screeningMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CENTRAL_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

// Bare "HH:MM:SS" wall-clock strings (events, notes) -- plain arithmetic,
// no timezone conversion involved.
function wallClockShort(total: number) {
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const period = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${period}`;
}
function wallClockMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

export function buildFlyerModel(screenings: ScreeningRow[], events: EventRow[], notes: NoteRow[], rangeStart: string | null, rangeDays: number): FlyerModel {
  const withDate = rangeDays > 7;
  const dayKeys = rangeStart ? Array.from({ length: rangeDays }, (_, i) => addDaysToKey(rangeStart, i)) : [];

  type Building = FilmBlock & { archive: boolean; chipMap: Map<string, FilmChip> };
  const films = new Map<string, Building>();
  for (const s of screenings) {
    if (!s.movie) continue;
    const key = centralDateKey(s.starts_at);
    const at = new Date(s.starts_at).getTime();
    let film = films.get(s.movie.title);
    if (!film) {
      film = {
        title: s.movie.title,
        posterUrl: s.movie.poster_url,
        rating: s.movie.rating,
        runtimeMinutes: s.movie.runtime_minutes,
        chips: [],
        firstAt: at,
        archive: !!s.movie.archive,
        chipMap: new Map(),
      };
      films.set(s.movie.title, film);
    }
    film.firstAt = Math.min(film.firstAt, at);
    if (!film.posterUrl && s.movie.poster_url) film.posterUrl = s.movie.poster_url;
    let chip = film.chipMap.get(key);
    if (!chip) {
      chip = { dateKey: key, day: dayLabel(key, withDate), times: [], outdoor: false };
      film.chipMap.set(key, chip);
    }
    chip.times.push({ label: shortTime(s.starts_at), minutes: screeningMinutes(s.starts_at) });
    chip.outdoor = chip.outdoor || isOutdoor(s.room?.name);
  }
  const finished = [...films.values()]
    .map(({ chipMap, ...film }) => ({
      ...film,
      chips: [...chipMap.values()]
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
        .map((c) => ({ ...c, times: [...c.times].sort((a, b) => a.minutes - b.minutes) })),
    }))
    .sort((a, b) => a.firstAt - b.firstAt);

  const busy = new Set<string>();
  for (const s of screenings) if (s.movie) busy.add(centralDateKey(s.starts_at));
  for (const e of events) busy.add(e.event_date);
  for (const n of notes) busy.add(n.note_date);

  const also: AlsoLine[] = [];
  const closed = dayKeys.filter((k) => !busy.has(k));
  if (closed.length > 0) {
    also.push({ kind: "closed", text: `CLOSED · ${closed.map((k) => dayLabel(k, true)).join(closed.length === 2 ? " & " : ", ")}` });
  }
  const dated: { date: string; minutes: number; line: AlsoLine }[] = [];
  for (const e of events) {
    const start = wallClockMinutes(e.event_time);
    const range = `${wallClockShort(start)}–${wallClockShort(start + Math.round(e.hours * 60))}`;
    const room = e.room?.name ? ` (${e.room.name})` : "";
    dated.push({ date: e.event_date, minutes: start, line: { kind: "event", text: truncate(`${dayLabel(e.event_date, true)} ${range} · ${e.event_name}${room}`, ALSO_MAX_CHARS) } });
  }
  for (const n of notes) {
    const time = n.start_time ? " " + wallClockShort(wallClockMinutes(n.start_time)) + (n.end_time ? `–${wallClockShort(wallClockMinutes(n.end_time))}` : "") : "";
    dated.push({ date: n.note_date, minutes: n.start_time ? wallClockMinutes(n.start_time) : -1, line: { kind: "note", text: truncate(`${dayLabel(n.note_date, true)}${time} · ${n.label}`, ALSO_MAX_CHARS) } });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
  also.push(...dated.map((d) => d.line));

  return {
    films: finished.filter((f) => !f.archive).map(({ archive: _a, ...f }) => f),
    archive: finished.filter((f) => f.archive).map(({ archive: _a, ...f }) => f),
    also,
  };
}

// ---- Layout / height budget -------------------------------------------------
// ImageResponse needs the canvas height up front, so it's estimated from the
// same constants the render below uses. Estimates lean generous (glyph
// widths use each face's average advance, titles budget a wrap at the
// measured line width) and any slack is absorbed by space-around in the
// film list, so the worst case is a little extra breathing room -- never
// clipped content.

function chipText(chip: FilmChip) {
  return `${chip.day} ${chip.times.map((t) => t.label).join(" · ")}${chip.outdoor ? " ☀ OUTDOOR" : ""}`;
}
function chipWidth(chip: FilmChip, fontSize: number) {
  return chipText(chip).length * fontSize * MONO_EM + CHIP_PAD_X * 2;
}
function chipRows(chips: FilmChip[], fontSize: number, availableW: number, gap: number) {
  let rows = 1;
  let x = 0;
  for (const c of chips) {
    const w = chipWidth(c, fontSize);
    if (x > 0 && x + gap + w > availableW) {
      rows++;
      x = w;
    } else {
      x += (x > 0 ? gap : 0) + w;
    }
  }
  return rows;
}
function metaText(f: FilmBlock) {
  return [f.rating, f.runtimeMinutes ? `${f.runtimeMinutes} MIN` : null].filter(Boolean).join(" · ");
}
// Titles wrap to at most two lines; anything longer is cut at the second
// line's width rather than hard-capped at a character count.
function fitTitle(title: string, fontSize: number, textW: number) {
  const perLine = Math.max(8, Math.floor(textW / (fontSize * DISPLAY_EM)));
  return { text: truncate(title, perLine * 2 - 2), lines: Math.min(2, Math.ceil(Math.min(title.length, perLine * 2 - 2) / perLine)), perLine };
}
function textWidthFor(tier: Tier) {
  return FLYER_W - PAD * 2 - tier.poster - tier.gap;
}
function filmHeight(f: FilmBlock, tier: Tier) {
  const textW = textWidthFor(tier);
  const title = fitTitle(f.title, tier.title, textW);
  const meta = metaText(f);
  const metaInline = title.lines === 1 && title.text.length * tier.title * DISPLAY_EM + 18 + meta.length * tier.meta * MONO_EM <= textW;
  const rows = chipRows(f.chips, tier.chip, textW, CHIP_GAP);
  const content = title.lines * tier.titleLine + (meta && !metaInline ? 30 : 0) + 12 + rows * tier.chipH + (rows - 1) * CHIP_GAP;
  return Math.max(tier.posterH + POSTER_SHADOW, content) + tier.padY * 2 + 2;
}
function archiveCardHeight(f: FilmBlock) {
  const title = fitTitle(f.title, ARCHIVE_TITLE, ARCHIVE_TEXT_W);
  const rows = chipRows(f.chips, ARCHIVE_CHIP, ARCHIVE_TEXT_W, 8);
  const content = title.lines * ARCHIVE_TITLE_LINE + 8 + rows * ARCHIVE_CHIP_H + (rows - 1) * 8;
  return Math.max(ARCHIVE_POSTER_H + 4, content) + ARCHIVE_CARD_PAD * 2;
}
function archiveHeight(archive: FilmBlock[]) {
  if (archive.length === 0) return 0;
  let rows = 0;
  for (let i = 0; i < archive.length; i += 2) {
    rows += Math.max(archiveCardHeight(archive[i]), archive[i + 1] ? archiveCardHeight(archive[i + 1]) : 0);
  }
  const rowCount = Math.ceil(archive.length / 2);
  return ARCHIVE_HEADER_H + ARCHIVE_PAD + rows + (rowCount - 1) * ARCHIVE_PAD + ARCHIVE_PAD;
}
function alsoHeight(also: AlsoLine[]) {
  return also.length === 0 ? 0 : ALSO_PAD_Y * 2 + ALSO_HEADER_LINE + 8 + also.length * ALSO_LINE + 3;
}

export interface FlyerOptions {
  headline: string;
  rangeLabel: string;
  note: string;
  membersEdition: boolean;
  qrDataUrl: string;
  logoDataUrl: string;
}
export interface FlyerLayout {
  tier: Tier;
  films: FilmBlock[];
  hiddenFilms: number;
  height: number;
}

export function fitFlyer(model: FlyerModel, opts: Pick<FlyerOptions, "note" | "membersEdition">): FlyerLayout {
  const fixed =
    MASTHEAD_H + (opts.membersEdition ? MEMBERS_STRIP_H : 0) + FOOTER_H + (opts.note ? NOTE_STRIP_H : 0) + alsoHeight(model.also) + archiveHeight(model.archive);
  const total = (films: FilmBlock[], tier: Tier) => fixed + films.reduce((sum, f) => sum + filmHeight(f, tier), 0);

  for (const tier of TIERS) {
    const height = total(model.films, tier);
    if (height <= MAX_H) return { tier, films: model.films, hiddenFilms: 0, height: Math.round(Math.max(MIN_H, height)) };
  }
  const tier = TIERS[TIERS.length - 1];
  let films = model.films;
  let height = total(films, tier);
  while (height > MAX_H && films.length > 1) {
    films = films.slice(0, -1);
    height = total(films, tier) + MORE_LINE_H;
  }
  return { tier, films, hiddenFilms: model.films.length - films.length, height: Math.round(Math.max(MIN_H, Math.min(MAX_H, height))) };
}

// ---- Assets ----------------------------------------------------------------
// Read once at module scope (Next's own recommendation for ImageResponse),
// not per request. Same process.cwd()-relative pattern as before so Vercel's
// file tracing bundles them into the function.

const ASSETS_DIR = join(process.cwd(), "src/app/admin/schedule-graphic");
const fontsPromise = Promise.all([
  readFile(join(ASSETS_DIR, "fonts/ArchivoBlack-Regular.ttf")),
  readFile(join(ASSETS_DIR, "fonts/Archivo-Regular.ttf")),
  readFile(join(ASSETS_DIR, "fonts/Archivo-Bold.ttf")),
  readFile(join(ASSETS_DIR, "fonts/SpaceMono-Regular.ttf")),
  readFile(join(ASSETS_DIR, "fonts/SpaceMono-Bold.ttf")),
]).then(([archivoBlack, archivoReg, archivoBold, monoReg, monoBold]) => [
  { name: DISPLAY, data: archivoBlack, weight: 900 as const, style: "normal" as const },
  { name: SANS, data: archivoReg, weight: 400 as const, style: "normal" as const },
  { name: SANS, data: archivoBold, weight: 700 as const, style: "normal" as const },
  { name: MONO, data: monoReg, weight: 400 as const, style: "normal" as const },
  { name: MONO, data: monoBold, weight: 700 as const, style: "normal" as const },
]);
const logoPromise = readFile(join(ASSETS_DIR, "assets/logo.png")).then((buf) => `data:image/png;base64,${buf.toString("base64")}`);

export function loadFonts() {
  return fontsPromise;
}
export function loadLogo() {
  return logoPromise;
}

// ---- Render ----------------------------------------------------------------

function Chip({ chip, fontSize, height }: { chip: FilmChip; fontSize: number; height: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height,
        padding: `0 ${CHIP_PAD_X}px`,
        backgroundColor: chip.outdoor ? GOLD : CREAM,
        borderRadius: 8,
        fontFamily: MONO,
        fontWeight: 700,
        fontSize,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: INK }}>{chip.day}</span>
      <span style={{ color: ACCENT, marginLeft: 12 }}>{chip.times.map((t) => t.label).join(" · ")}</span>
      {chip.outdoor && <span style={{ color: INK, marginLeft: 12 }}>☀ OUTDOOR</span>}
    </div>
  );
}

function Poster({ url, width, height, shadow }: { url: string | null; width: number; height: number; shadow: number }) {
  if (!url) {
    return (
      <div style={{ display: "flex", width, height, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: INK_CARD, border: `2px solid ${INK_RULE}`, fontFamily: MONO, fontSize: 16, color: ON_INK_MUTED, flexShrink: 0 }}>
        NO POSTER
      </div>
    );
  }
  return <img src={url} width={width} height={height} style={{ width, height, objectFit: "cover", borderRadius: 6, boxShadow: `${shadow}px ${shadow}px 0 ${GOLD}`, flexShrink: 0 }} />;
}

function Film({ film, tier, first }: { film: FilmBlock; tier: Tier; first: boolean }) {
  const textW = textWidthFor(tier);
  const title = fitTitle(film.title, tier.title, textW);
  const meta = metaText(film);
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: tier.gap, padding: `${tier.padY}px 0`, borderTop: first ? "none" : `2px solid ${INK_RULE}` }}>
      <Poster url={film.posterUrl} width={tier.poster} height={tier.posterH} shadow={POSTER_SHADOW} />
      {/* Vertically centered against the poster, so the block reads as one
          unit instead of text clumped in its top corner. */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", minHeight: tier.posterH }}>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 18 }}>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: tier.title, lineHeight: `${tier.titleLine}px`, color: CREAM }}>{title.text}</div>
          {meta && <div style={{ display: "flex", fontFamily: MONO, fontSize: tier.meta, lineHeight: "30px", color: ON_INK_MUTED }}>{meta}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: CHIP_GAP, marginTop: 12 }}>
          {film.chips.map((chip) => (
            <Chip key={chip.dateKey} chip={chip} fontSize={tier.chip} height={tier.chipH} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ArchiveCard({ film }: { film: FilmBlock }) {
  const title = fitTitle(film.title, ARCHIVE_TITLE, ARCHIVE_TEXT_W);
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 14, width: ARCHIVE_CARD_W, padding: ARCHIVE_CARD_PAD, backgroundColor: INK_CARD, borderRadius: 10 }}>
      <Poster url={film.posterUrl} width={ARCHIVE_POSTER_W} height={ARCHIVE_POSTER_H} shadow={4} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", minHeight: ARCHIVE_POSTER_H }}>
        <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: ARCHIVE_TITLE, lineHeight: `${ARCHIVE_TITLE_LINE}px`, color: CREAM }}>{title.text}</div>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {film.chips.map((chip) => (
            <Chip key={chip.dateKey} chip={chip} fontSize={ARCHIVE_CHIP} height={ARCHIVE_CHIP_H} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function renderFlyer(layout: FlyerLayout, model: FlyerModel, opts: FlyerOptions) {
  const { tier } = layout;
  return (
    <div style={{ width: FLYER_W, height: layout.height, display: "flex", flexDirection: "column", backgroundColor: INK, fontFamily: SANS }}>
      {/* Masthead */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: MASTHEAD_H, padding: `0 ${PAD}px`, borderBottom: `6px solid ${GOLD}` }}>
        <img src={opts.logoDataUrl} width={340} height={120} style={{ width: 340, height: 120 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 68, lineHeight: 1, color: GOLD }}>{opts.headline}</div>
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 24, color: ON_INK_SOFT, marginTop: 8 }}>{opts.rangeLabel}</div>
        </div>
      </div>

      {opts.membersEdition && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: MEMBERS_STRIP_H, backgroundColor: GOLD, fontFamily: MONO, fontWeight: 700, fontSize: 21, letterSpacing: 2, color: INK }}>
          MEMBERS&apos; EDITION · INSIDERS EMAIL LIST ONLY
        </div>
      )}

      {/* Films */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-around", padding: `0 ${PAD}px` }}>
        {layout.films.length === 0 && model.archive.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 40, color: ON_INK_MUTED }}>No screenings selected</div>
        ) : (
          layout.films.map((film, i) => <Film key={film.title} film={film} tier={tier} first={i === 0} />)
        )}
        {layout.hiddenFilms > 0 && (
          <div style={{ display: "flex", alignItems: "center", height: MORE_LINE_H, fontFamily: DISPLAY, fontSize: 30, color: GOLD, borderTop: `2px solid ${INK_RULE}` }}>
            +{layout.hiddenFilms} MORE {layout.hiddenFilms === 1 ? "FILM" : "FILMS"} THIS WEEK — SCAN FOR SHOWTIMES
          </div>
        )}
      </div>

      {/* Film archive -- members' edition only */}
      {model.archive.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: ARCHIVE_HEADER_H, padding: `0 ${PAD}px`, backgroundColor: GOLD }}>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 28, color: INK }}>FROM THE FILM ARCHIVE</div>
            <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 20, letterSpacing: 2, color: INK }}>MEMBERS ONLY</div>
          </div>
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: ARCHIVE_PAD, padding: `${ARCHIVE_PAD}px ${PAD}px` }}>
            {model.archive.map((film) => (
              <ArchiveCard key={film.title} film={film} />
            ))}
          </div>
        </div>
      )}

      {/* Also this week: closed days, private bookings, notes */}
      {model.also.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", padding: `${ALSO_PAD_Y}px ${PAD}px`, borderTop: `3px solid ${INK_RULE}` }}>
          <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 21, lineHeight: `${ALSO_HEADER_LINE}px`, letterSpacing: 2, color: ON_INK_MUTED, marginBottom: 8 }}>ALSO THIS WEEK</div>
          {model.also.map((line, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                fontFamily: SANS,
                fontWeight: 700,
                fontStyle: line.kind === "note" ? "italic" : "normal",
                fontSize: 28,
                lineHeight: `${ALSO_LINE}px`,
                color: line.kind === "event" ? GOLD : line.kind === "note" ? ON_INK_SOFT : CREAM,
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}

      {opts.note && (
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16, height: NOTE_STRIP_H, padding: `0 ${PAD}px`, backgroundColor: ACCENT }}>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 24, color: SURFACE }}>PLAN AHEAD</div>
          <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: 26, color: SURFACE }}>{truncate(opts.note, 52)}</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: FOOTER_H, padding: `0 ${PAD}px`, backgroundColor: GOLD }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", padding: 7, backgroundColor: SURFACE, borderRadius: 8 }}>
            <img src={opts.qrDataUrl} width={104} height={104} style={{ width: 104, height: 104 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 28, lineHeight: 1.05, color: INK }}>SCAN FOR</div>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 28, lineHeight: 1.05, color: ACCENT }}>SHOWTIMES</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 28, lineHeight: 1.05, color: INK }}>INSIDERS+ $15/MO</div>
          <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 20, color: INK, marginTop: 4 }}>FREE ENTRY TO EVERY SCREENING</div>
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 18, color: INK, opacity: 0.7, marginTop: 12 }}>715 E BROADWAY, JOPLIN MO · 417-281-4172</div>
        </div>
      </div>
    </div>
  );
}
