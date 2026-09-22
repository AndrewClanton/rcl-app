import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

const CENTRAL_TZ = "America/Chicago";

// Design concept: "the Royale Proof Sheet" -- a piece of printed
// film-industry ephemera (part programming calendar, part press proof,
// part movie poster) rather than a screenshot of a web page or a dense
// spec sheet. First pass erred toward information density at UI-chrome
// scale (11-18px text); this one is built for POSTER scale -- huge type,
// big imagery, minimal small print, every zone either carrying a large
// graphic or large text. Exact per-showtime detail lives on the site
// (the QR code goes straight to it); the graphic's job is to be seen and
// read from across a room or a thumb's-width on a phone, not to be a
// complete database dump.
//
// Matches the site's own design tokens (src/app/globals.css) -- Satori
// renders in total isolation from the app's CSS, so these have to be
// literal hex values, not var() references.
const BG = "#f8f5ec";
const SURFACE = "#ffffff";
const SURFACE_HOVER = "#f2ecd8";
const BORDER = "#e3ddc9";
const INK = "#14110c";
const MUTED = "#6b6455";
const ACCENT = "#ed1c24";
const ACCENT_FG = "#ffffff";
const GOLD = "#ffc72c";
const GOLD_FG = "#14110c";
const WARN_BG = "#fdf1d6";
const WARN_BORDER = "#e8c266";
const WARN_TEXT = "#8a5a0a";
const NOTE_TEXT = "#4a4438";

// Day headers alternate gold/red -- the same two-color "stamp" pairing
// used for badges across the real site, instead of a 3-color rainbow that
// doesn't exist anywhere else in the brand.
const DAY_HEADERS = [
  { bg: GOLD, fg: GOLD_FG },
  { bg: ACCENT, fg: ACCENT_FG },
];

const DISPLAY = "Archivo Black";
const SANS = "Archivo";
const MONO = "Space Mono";

// Fonts don't depend on request data -- read once at module scope (Next's
// own recommendation for ImageResponse) rather than on every request.
const FONTS_DIR = join(process.cwd(), "src/app/admin/schedule-graphic/fonts");
const fontsPromise = Promise.all([
  readFile(join(FONTS_DIR, "ArchivoBlack-Regular.ttf")),
  readFile(join(FONTS_DIR, "Archivo-Regular.ttf")),
  readFile(join(FONTS_DIR, "Archivo-Bold.ttf")),
  readFile(join(FONTS_DIR, "SpaceMono-Regular.ttf")),
  readFile(join(FONTS_DIR, "SpaceMono-Bold.ttf")),
]).then(([archivoBlack, archivoReg, archivoBold, monoReg, monoBold]) => [
  { name: DISPLAY, data: archivoBlack, weight: 900 as const, style: "normal" as const },
  { name: SANS, data: archivoReg, weight: 400 as const, style: "normal" as const },
  { name: SANS, data: archivoBold, weight: 700 as const, style: "normal" as const },
  { name: MONO, data: monoReg, weight: 400 as const, style: "normal" as const },
  { name: MONO, data: monoBold, weight: 700 as const, style: "normal" as const },
]);

interface ScreeningRow {
  id: string;
  starts_at: string;
  movie: { title: string; poster_url: string | null; runtime_minutes: number | null; rating: string | null } | null;
  room: { name: string } | null;
}
interface EventRow {
  id: string;
  event_name: string;
  event_date: string;
  event_time: string;
  hours: number;
  room: { name: string } | null;
}
interface NoteRow {
  id: string;
  note_date: string;
  start_time: string | null;
  end_time: string | null;
  label: string;
}

interface DayEntry {
  kind: "screening" | "event" | "note";
  time: string;
  sortMinutes: number; // minutes since midnight, for chronological sort -- `time` is a display string and can't be lexically sorted (e.g. "06:00PM" < "12:00PM")
  title: string;
  outdoor: boolean;
  rating?: string | null;
  sub?: string; // room name, for events
}
interface DayGroup {
  dateKey: string;
  weekday: string;
  dateLabel: string;
  entries: DayEntry[];
}

// One line's worth of content once same-title screenings on the same day
// are collapsed together -- "BUDDY" at 12:00 and 4:00 becomes one line
// with two times instead of two separate lines, which is both more
// compact and closer to how a person actually thinks about "what's
// playing" (by title, not as a flat chronological list).
interface GroupedLine {
  kind: "screening" | "event" | "note";
  title: string;
  times: string[];
  outdoor: boolean;
  rating?: string | null;
  sub?: string;
  sortMinutes: number;
}

interface Poster {
  title: string;
  url: string;
  rating: string | null;
  runtimeMinutes: number | null;
}

function isOutdoor(roomName: string | null | undefined) {
  return !!roomName && roomName.toLowerCase().includes("outdoor");
}

function centralDateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function dayPartsFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }).toUpperCase(),
    dateLabel: date.toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric" }),
  };
}

function screeningTime(iso: string) {
  return new Date(iso)
    .toLocaleTimeString("en-US", { timeZone: CENTRAL_TZ, hour: "numeric", minute: "2-digit" })
    .replace(" ", "")
    .toUpperCase();
}

// hourCycle "h23" avoids the well-known Intl quirk where hour12:false alone
// can format midnight as "24:00" instead of "00:00" in some engines.
function screeningMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CENTRAL_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

function wallClockMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// event_time is a bare "HH:MM:SS" (no timezone -- a wall-clock time entered
// by staff for the venue itself, not a UTC instant), so this is plain
// arithmetic, not a timezone conversion.
function eventTimeRange(time: string, hours: number) {
  const [h, m] = time.split(":").map(Number);
  const startMinutes = h * 60 + m;
  const endMinutes = startMinutes + Math.round(hours * 60);
  const fmt = (total: number) => {
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    const period = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${hour12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${period}`;
  };
  return `${fmt(startMinutes)}-${fmt(endMinutes)}`;
}

// start_time/end_time are bare "HH:MM:SS" wall-clock strings, same as
// event_time -- no timezone conversion involved.
function noteTimeLabel(start: string | null, end: string | null): string {
  if (!start) return "";
  const fmtOne = (t: string) => {
    const [hh, mm] = t.split(":").map(Number);
    const period = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${hour12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${period}`;
  };
  return end ? `${fmtOne(start)}-${fmtOne(end)}` : fmtOne(start);
}

function addDaysToKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function groupByDay(screenings: ScreeningRow[], events: EventRow[], notes: NoteRow[], rangeStart: string | null, rangeDays: number): DayGroup[] {
  const byDay = new Map<string, DayGroup>();
  function ensure(dateKey: string): DayGroup {
    let g = byDay.get(dateKey);
    if (!g) {
      const parts = dayPartsFromKey(dateKey);
      g = { dateKey, weekday: parts.weekday, dateLabel: parts.dateLabel, entries: [] };
      byDay.set(dateKey, g);
    }
    return g;
  }

  // Seed every calendar day in the requested range up front so a genuinely
  // empty day still gets a CLOSED cell instead of silently disappearing.
  if (rangeStart) {
    for (let i = 0; i < rangeDays; i++) ensure(addDaysToKey(rangeStart, i));
  }

  for (const s of screenings) {
    if (!s.movie) continue;
    const key = centralDateKey(s.starts_at);
    ensure(key).entries.push({
      kind: "screening",
      time: screeningTime(s.starts_at),
      sortMinutes: screeningMinutes(s.starts_at),
      title: s.movie.title,
      outdoor: isOutdoor(s.room?.name),
      rating: s.movie.rating,
    });
  }
  for (const e of events) {
    ensure(e.event_date).entries.push({
      kind: "event",
      time: eventTimeRange(e.event_time, e.hours),
      sortMinutes: wallClockMinutes(e.event_time),
      title: e.event_name,
      outdoor: false,
      sub: e.room?.name,
    });
  }
  for (const n of notes) {
    ensure(n.note_date).entries.push({
      kind: "note",
      time: noteTimeLabel(n.start_time, n.end_time),
      // No start_time = an all-day note -- sort it first (-1), ahead of any timed entry.
      sortMinutes: n.start_time ? wallClockMinutes(n.start_time) : -1,
      title: n.label,
      outdoor: false,
    });
  }

  for (const g of byDay.values()) g.entries.sort((a, b) => a.sortMinutes - b.sortMinutes);
  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// Long titles get a hard cap so a poster-scale line can't unpredictably
// wrap to 2-3 lines and blow the (carefully budgeted) canvas height.
function truncateTitle(title: string, max = 28): string {
  return title.length > max ? title.slice(0, max - 1).trimEnd() + "…" : title;
}

// Collapses same-title screenings on the same day into one line with all
// their times -- both more compact and more natural to read than a flat
// chronological list. Events/notes stay their own lines (they're one-off
// by nature, not repeat showtimes).
function groupDayEntries(entries: DayEntry[]): GroupedLine[] {
  const out: GroupedLine[] = [];
  const screeningIndex = new Map<string, GroupedLine>();
  for (const e of entries) {
    if (e.kind !== "screening") {
      out.push({ kind: e.kind, title: e.title, times: [e.time], outdoor: e.outdoor, sub: e.sub, sortMinutes: e.sortMinutes });
      continue;
    }
    const existing = screeningIndex.get(e.title);
    if (existing) {
      existing.times.push(e.time);
      existing.outdoor = existing.outdoor || e.outdoor;
    } else {
      const line: GroupedLine = { kind: "screening", title: truncateTitle(e.title), times: [e.time], outdoor: e.outdoor, rating: e.rating, sortMinutes: e.sortMinutes };
      screeningIndex.set(e.title, line);
      out.push(line);
    }
  }
  return out.sort((a, b) => a.sortMinutes - b.sortMinutes);
}

function uniquePosters(screenings: ScreeningRow[], limit: number): Poster[] {
  const seen = new Map<string, Poster>();
  for (const s of screenings) {
    if (s.movie?.poster_url && !seen.has(s.movie.title)) {
      seen.set(s.movie.title, {
        title: s.movie.title,
        url: s.movie.poster_url,
        rating: s.movie.rating,
        runtimeMinutes: s.movie.runtime_minutes,
      });
    }
  }
  return [...seen.values()].slice(0, limit);
}

// Prefer an outdoor screening as the spotlighted pick (it's the special,
// weather-dependent one worth calling out) -- otherwise the first
// screening in range that actually has a poster to show.
function pickFeatured(screenings: ScreeningRow[]): Poster | null {
  const withPoster = screenings.filter((s) => s.movie?.poster_url);
  const outdoor = withPoster.find((s) => isOutdoor(s.room?.name));
  const chosen = outdoor ?? withPoster[0];
  if (!chosen?.movie) return null;
  return {
    title: chosen.movie.title,
    url: chosen.movie.poster_url!,
    rating: chosen.movie.rating,
    runtimeMinutes: chosen.movie.runtime_minutes,
  };
}

// ---- Shared pre-press / print devices ------------------------------------

// A Ben-Day dot screen, hand-unrolled as a grid of small circles (Satori
// doesn't support tiling a CSS radial-gradient background) -- fades in
// across the band the way the real ink-on-ink halftone texture does on the
// site's own hero panels. Dot count is kept modest (cols*rows, currently 24).
//
// Performance note (cost real debugging time, worth recording): this overlay
// always sits inside a parent with `overflow: hidden` (for the rounded
// corners). On Satori/resvg, an overflow:hidden clip's cost scales with BOTH
// the number of descendants inside it AND the total canvas height -- not
// with descendant size, opacity, or font size, which all had zero measured
// effect. At the portrait format's ~4200px canvas height, 75 dots under one
// clip cost ~9-10s by themselves; the same clip with 24 dots costs a small
// fraction of that. The other half of this fix was removing overflow:hidden
// entirely from the 7 day-list boxes below and the hero poster frame, since
// their content no longer needs clipping (capped lines, exact-fit image) --
// that alone cut another ~10s. Moral: on a tall generated canvas, prefer no
// clip at all, and where one is unavoidable, keep what's inside it small.
function HalftoneOverlay({ width, height, color = INK, maxOpacity = 0.16 }: { width: number; height: number; color?: string; maxOpacity?: number }) {
  const cols = 8;
  const rows = 3;
  const cellW = width / cols;
  const cellH = height / rows;
  const dotSize = Math.min(cellW, cellH) * 0.55;
  const dots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fade = c / (cols - 1);
      dots.push(
        <div
          key={`${r}-${c}`}
          style={{
            display: "flex",
            position: "absolute",
            left: c * cellW + cellW / 2 - dotSize / 2,
            top: r * cellH + cellH / 2 - dotSize / 2,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize,
            backgroundColor: color,
            opacity: 0.03 + maxOpacity * fade,
          }}
        />,
      );
    }
  }
  return <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width, height }}>{dots}</div>;
}

// Pre-press registration mark -- a crosshair-in-a-circle, the printer's
// alignment device carried over from the site's mockup phase.
function RegistrationMark({ size = 22, color = MUTED }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "flex" }}>
      <circle cx="12" cy="12" r="7" fill="none" stroke={color} strokeWidth="1" />
      <line x1="12" y1="0" x2="12" y2="24" stroke={color} strokeWidth="1" />
      <line x1="0" y1="12" x2="24" y2="12" stroke={color} strokeWidth="1" />
    </svg>
  );
}

// A press color-proof bar -- swatches of the brand's actual print palette,
// standing in for the CMYK bar a real film lab would strike on a proof.
function ColorBar({ size = 22 }: { size?: number }) {
  const swatches = [GOLD, ACCENT, INK, SURFACE];
  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 5 }}>
      {swatches.map((c, i) => (
        <div key={i} style={{ display: "flex", width: size, height: size, backgroundColor: c, border: c === SURFACE ? `1.5px solid ${BORDER}` : "none" }} />
      ))}
    </div>
  );
}

// The medium is the message: a strip of film with punched sprocket holes
// (small circles matching the page background, so they read as "holes"),
// carrying poster thumbnails like frames on a reel.
function Filmstrip({ posters, frameW, frameH, holeCount }: { posters: Poster[]; frameW: number; frameH: number; holeCount: number }) {
  const holeSize = Math.max(10, Math.round(frameH * 0.09));
  const holeRow = (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", padding: "0 20px" }}>
      {Array.from({ length: holeCount }).map((_, i) => (
        <div key={i} style={{ display: "flex", width: holeSize, height: holeSize, borderRadius: holeSize, backgroundColor: BG }} />
      ))}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", backgroundColor: INK, borderRadius: 10, paddingTop: 10, paddingBottom: 10 }}>
      {holeRow}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, padding: "10px 14px" }}>
        {posters.length === 0 ? (
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 20, color: "#8a8378" }}>NO REEL SELECTED</div>
        ) : (
          posters.map((p) => (
            <img key={p.title} src={p.url} width={frameW} height={frameH} style={{ width: frameW, height: frameH, borderRadius: 4, objectFit: "cover", border: "1.5px solid #3a352c" }} />
          ))
        )}
      </div>
      {holeRow}
    </div>
  );
}

// A rotated rubber-stamp callout advertising the Insiders+ perk directly
// inside the schedule graphic -- the graphic doubles as a membership ad
// wherever it's shared or posted.
function MembershipStamp({ scale = 1 }: { scale?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: INK,
        borderRadius: 10,
        padding: `${14 * scale}px ${22 * scale}px`,
        transform: "rotate(-2deg)",
      }}
    >
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 30 * scale, color: GOLD }}>INSIDERS+</div>
      <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 16 * scale, color: BG, letterSpacing: 0.5 }}>$15/MO · FREE ENTRY</div>
    </div>
  );
}

function BoothChip({ scale = 1 }: { scale?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: SURFACE,
        border: `2px solid ${INK}`,
        borderRadius: 10,
        padding: `${14 * scale}px ${22 * scale}px`,
        transform: "rotate(1.5deg)",
      }}
    >
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 26 * scale, color: INK }}>8 LOUNGE BOOTHS</div>
      <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 16 * scale, color: ACCENT, letterSpacing: 0.5 }}>RESERVE ONLINE · $25</div>
    </div>
  );
}

// Real menu items, not invented copy -- the coffee bar's movie-themed
// drinks (City of Stars, Oppenheimer, Titanic...) are exactly the kind of
// charming specific detail worth surfacing here.
function NowPouring({ items, scale = 1 }: { items: string[]; scale?: number }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 * scale, justifyContent: "center" }}>
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 24 * scale, color: INK }}>NOW POURING</div>
      <div style={{ display: "flex", fontFamily: MONO, fontSize: 17 * scale, color: MUTED }}>{items.join("  ·  ")}</div>
    </div>
  );
}

function QrBadge({ dataUrl, size = 130 }: { dataUrl: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", padding: 8, backgroundColor: SURFACE, border: `2px solid ${INK}`, borderRadius: 8 }}>
        <img src={dataUrl} width={size} height={size} style={{ width: size, height: size }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 26, color: INK }}>SCAN FOR</div>
        <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 26, color: ACCENT }}>SHOWTIMES</div>
      </div>
    </div>
  );
}

function RatingBadge({ rating, size = 20 }: { rating?: string | null; size?: number }) {
  if (!rating) return null;
  return (
    <span style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: size, color: MUTED, border: `1.5px solid ${BORDER}`, borderRadius: 5, padding: "3px 8px" }}>{rating}</span>
  );
}

// A closed/empty day reads as one bold compact tag, not a gap -- and takes
// only the room it needs, so the day it belongs to stays short instead of
// leaving a wasted block the height of a busy day.
function ClosedTag() {
  return (
    <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 28, letterSpacing: 1.5, color: MUTED, border: `2px solid ${BORDER}`, borderRadius: 6, padding: "8px 18px" }}>CLOSED</div>
  );
}

// One grouped line (title + its time(s)) at poster scale. Time(s) sit
// right after the title on the same baseline, in mono, so a title with 3
// showtimes still reads as one confident line instead of stacking.
// Simple stacked layout (title line, then a time/meta line below) instead
// of a wrapped single row -- mirrors the grid format's day-column entries,
// which render far faster in Satori than a flex-wrapped row with multiple
// mixed-style children repeated across many lines.
function GroupedLineView({ line, titleSize, timeSize }: { line: GroupedLine; titleSize: number; timeSize: number }) {
  if (line.kind === "event") {
    return (
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: WARN_BG, border: `2px solid ${WARN_BORDER}`, borderRadius: 8, padding: "8px 16px" }}>
        <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: titleSize, color: WARN_TEXT }}>{line.title}</div>
        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: timeSize, color: WARN_TEXT, opacity: 0.8 }}>{line.times[0]}</div>
      </div>
    );
  }
  if (line.kind === "note") {
    return (
      <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontStyle: "italic", fontSize: titleSize, color: NOTE_TEXT, backgroundColor: SURFACE_HOVER, border: `2px solid ${BORDER}`, borderRadius: 8, padding: "8px 16px" }}>
        {line.title}
      </div>
    );
  }
  const meta = line.times.join(" · ") + (line.outdoor ? "  ☀ OUTDOOR" : "");
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: titleSize, color: INK, lineHeight: 1.05 }}>{line.title}</div>
      <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: timeSize, color: line.outdoor ? GOLD_FG : ACCENT, backgroundColor: line.outdoor ? GOLD : "transparent" }}>{meta}</div>
    </div>
  );
}

function Masthead({ title, rangeLabel, width, height }: { title: string; rangeLabel: string; width: number; height: number }) {
  return (
    <div style={{ display: "flex", position: "relative", flexDirection: "column", alignItems: "center", justifyContent: "center", width, height, backgroundColor: GOLD, border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `7px 7px 0 ${INK}` }}>
      <HalftoneOverlay width={width} height={height} color={ACCENT} maxOpacity={0.24} />
      <div style={{ display: "flex", position: "absolute", top: 16, left: 18 }}>
        <RegistrationMark size={30} color="rgba(20,17,12,0.45)" />
      </div>
      <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, color: ACCENT }}>ROYALE CINEMA LOUNGE</div>
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: Math.round(height * 0.34), color: INK, textAlign: "center", lineHeight: 1.02, marginTop: 4 }}>{title}</div>
      <div style={{ display: "flex", fontFamily: MONO, fontSize: 22, color: INK, opacity: 0.7, marginTop: 6 }}>{rangeLabel}</div>
    </div>
  );
}

function Footer({ qrDataUrl, addressSize = 22 }: { qrDataUrl: string; addressSize?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <QrBadge dataUrl={qrDataUrl} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
        <div style={{ display: "flex", fontFamily: MONO, fontSize: addressSize, color: MUTED }}>715 E BROADWAY, JOPLIN MO</div>
        <div style={{ display: "flex", fontFamily: MONO, fontSize: addressSize, color: MUTED }}>417-281-4172</div>
        <ColorBar />
      </div>
    </div>
  );
}

// ---- Grid (1920x1080, fixed -- landscape wall/monitor display) -----------

async function renderGrid(days: DayGroup[], allScreenings: ScreeningRow[], rangeLabel: string, note: string, qrDataUrl: string, pouring: string[]) {
  const posters = uniquePosters(allScreenings, 4);
  const gridDays = days.slice(0, 7);
  const featured = pickFeatured(allScreenings);

  return (
    <div style={{ width: "1920px", height: "1080px", display: "flex", flexDirection: "column", backgroundColor: BG, padding: "26px", gap: "16px", fontFamily: SANS }}>
      <div style={{ display: "flex", flexDirection: "row", gap: "20px", flex: 1 }}>
        {/* Hero: one big poster + huge pick, dominating the left third */}
        <div style={{ display: "flex", flexDirection: "column", width: 480, gap: "14px" }}>
          <div style={{ display: "flex", position: "relative", flexDirection: "column", alignItems: "center", backgroundColor: GOLD, border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `6px 6px 0 ${INK}`, padding: "14px", overflow: "hidden" }}>
            <HalftoneOverlay width={480} height={90} color={ACCENT} maxOpacity={0.22} />
            <div style={{ display: "flex", position: "absolute", top: 10, left: 12 }}>
              <RegistrationMark size={22} color="rgba(20,17,12,0.4)" />
            </div>
            <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 16, letterSpacing: 2, color: ACCENT }}>JOPLIN, MO</div>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 46, color: INK, textAlign: "center", lineHeight: 1 }}>THIS WEEK</div>
            <div style={{ display: "flex", fontFamily: MONO, fontSize: 16, color: INK, opacity: 0.7 }}>{rangeLabel}</div>
          </div>

          {featured && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `3px solid ${INK}`, borderRadius: 12, boxShadow: `6px 6px 0 ${ACCENT}`, padding: "16px", gap: 10 }}>
              <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 18, color: ACCENT, letterSpacing: 1.5 }}>THIS WEEK&apos;S PICK</div>
              <img src={featured.url} width={448} height={300} style={{ width: 448, height: 300, borderRadius: 8, objectFit: "cover", objectPosition: "top", border: `2px solid ${BORDER}` }} />
              <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 34, color: INK, lineHeight: 1.05 }}>{truncateTitle(featured.title, 22)}</div>
              <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                <RatingBadge rating={featured.rating} size={18} />
                {featured.runtimeMinutes && (
                  <span style={{ display: "flex", fontFamily: MONO, fontSize: 18, color: MUTED, border: `1.5px solid ${BORDER}`, borderRadius: 5, padding: "3px 8px" }}>{featured.runtimeMinutes}m</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 7-day columns -- title + times, grouped, poster-scale */}
        <div style={{ display: "flex", flexDirection: "row", flex: 1, gap: "10px" }}>
          {gridDays.map((day, i) => {
            const header = DAY_HEADERS[i % DAY_HEADERS.length];
            const lines = groupDayEntries(day.entries);
            return (
              <div key={day.dateKey} style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `2.5px solid ${INK}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", flexDirection: "column", backgroundColor: header.bg, padding: "10px 4px", alignItems: "center" }}>
                  <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 24, color: header.fg }}>{day.weekday.slice(0, 3)}</div>
                  <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 15, color: header.fg, opacity: 0.75 }}>{day.dateLabel}</div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: lines.length === 0 ? "center" : "flex-start", alignItems: lines.length === 0 ? "center" : "stretch", padding: "10px 8px", gap: "10px" }}>
                  {lines.length === 0 ? (
                    <ClosedTag />
                  ) : (
                    lines.slice(0, 5).map((line, li) => (
                      <div key={li} style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 19, color: INK, lineHeight: 1.05 }}>{line.title}</div>
                        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 13, color: ACCENT }}>
                          {line.times.join(" · ")}
                          {line.outdoor ? " ☀" : ""}
                        </div>
                      </div>
                    ))
                  )}
                  {lines.length > 5 && <div style={{ display: "flex", fontFamily: MONO, fontSize: 12, color: MUTED }}>+{lines.length - 5} MORE</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right rail: promo stack */}
        <div style={{ display: "flex", flexDirection: "column", width: 400, gap: "14px" }}>
          <Filmstrip posters={posters} frameW={80} frameH={118} holeCount={10} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MembershipStamp scale={0.85} />
            <BoothChip scale={0.85} />
          </div>
          <div style={{ display: "flex", backgroundColor: SURFACE, border: `2px solid ${BORDER}`, borderRadius: 10, padding: "14px 16px" }}>
            <NowPouring items={pouring} scale={0.85} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: INK, borderRadius: 10, padding: "16px", justifyContent: "center", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 20, color: GOLD, textAlign: "center" }}>PLAN AHEAD</div>
            <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: note ? 22 : 16, color: BG, textAlign: "center" }}>{note || "Ask us what's coming up next."}</div>
          </div>
          <Footer qrDataUrl={qrDataUrl} addressSize={14} />
        </div>
      </div>
    </div>
  );
}

// ---- Banner (1200x628, fixed -- social link-preview card) ----------------
// Small real-world display size demands the most restraint of the three:
// one big hero image, a short punchy headline, and a handful of titles --
// not a data grid. Exact times live behind the QR code.

function renderBanner(days: DayGroup[], allScreenings: ScreeningRow[], rangeLabel: string, qrDataUrl: string) {
  const featured = pickFeatured(allScreenings);
  const titles: string[] = [];
  for (const day of days) {
    for (const line of groupDayEntries(day.entries)) {
      if (line.kind === "screening" && !titles.includes(line.title)) titles.push(line.title);
      if (titles.length >= 6) break;
    }
    if (titles.length >= 6) break;
  }

  return (
    <div style={{ width: "1200px", height: "628px", display: "flex", flexDirection: "row", backgroundColor: BG, fontFamily: SANS }}>
      {featured ? (
        <div style={{ display: "flex", position: "relative", width: 420, height: 628 }}>
          <img src={featured.url} width={420} height={628} style={{ width: 420, height: 628, objectFit: "cover" }} />
          <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: 420, height: 628, backgroundColor: INK, opacity: 0.12 }} />
        </div>
      ) : (
        <div style={{ display: "flex", width: 420, height: 628, backgroundColor: GOLD }} />
      )}

      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "28px 32px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 18, letterSpacing: 2, color: ACCENT }}>ROYALE CINEMA LOUNGE</div>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 64, color: INK, lineHeight: 0.95 }}>THIS WEEK</div>
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 18, color: MUTED }}>{rangeLabel}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {titles.length === 0 ? (
            <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: 24, color: MUTED }}>No screenings selected</div>
          ) : (
            titles.map((t) => (
              <div key={t} style={{ display: "flex", fontFamily: DISPLAY, fontSize: 30, color: INK, lineHeight: 1 }}>
                {truncateTitle(t, 30)}
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontFamily: MONO, fontSize: 15, color: MUTED }}>715 E BROADWAY, JOPLIN MO</div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 16, color: ACCENT }}>SCAN FOR SHOWTIMES</div>
            <img src={qrDataUrl} width={70} height={70} style={{ width: 70, height: 70, border: `2px solid ${INK}`, borderRadius: 5 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Portrait (1080 wide, HEIGHT COMPUTED FROM CONTENT) -------------------
// The flagship phone/share format. Rather than cramming poster-scale type
// into an arbitrary fixed 1920px canvas, the canvas height is computed
// from the actual grouped content (see estimatePortraitHeight, which uses
// the exact same row constants as the render function below) so a light
// week and a packed week both end up close to zero dead space instead of
// one being crammed and the other mostly empty.

const PORTRAIT_W = 1080;
const P_PAD = 30;
const P_MASTHEAD_H = 300;
const P_HERO_H = 640;
const P_PROMO_H = 170;
const P_FOOTER_H = 170;
const P_GAP = 20;
const P_DAY_HEADER_H = 92;
const P_DAY_LINE_H = 78; // per grouped line -- generous enough to absorb an occasional title wrap
const P_DAY_PAD_V = 28;
const P_DAY_CLOSED_H = P_DAY_HEADER_H + 78;
// A day showing every grouped line has no upper bound on element count, which
// both blows the canvas height on a packed day and -- far more importantly --
// is the single biggest render-time cost in this file: Satori/resvg's cost
// for a large field of sibling boxes on a big canvas scales steeply with
// element count (confirmed empirically, independent of font size, box size,
// or opacity), so an unbounded per-day line list is a real production-timeout
// risk, not just a layout nicety. Capped the same way the grid format already
// caps its columns.
const P_DAY_MAX_LINES = 5;
const P_DAY_MORE_H = 44;

function estimateDayHeight(day: DayGroup): number {
  const lines = groupDayEntries(day.entries);
  if (lines.length === 0) return P_DAY_CLOSED_H;
  const shown = Math.min(lines.length, P_DAY_MAX_LINES);
  const moreH = lines.length > P_DAY_MAX_LINES ? P_DAY_MORE_H : 0;
  return P_DAY_HEADER_H + shown * P_DAY_LINE_H + moreH + P_DAY_PAD_V;
}

function estimatePortraitHeight(days: DayGroup[]): number {
  const shown = days.slice(0, 7);
  const daysTotal = shown.reduce((sum, d) => sum + estimateDayHeight(d) + P_GAP, 0);
  return P_PAD * 2 + P_MASTHEAD_H + P_GAP + P_HERO_H + P_GAP + daysTotal + P_PROMO_H + P_GAP + P_FOOTER_H;
}

function renderPortrait(days: DayGroup[], allScreenings: ScreeningRow[], rangeLabel: string, qrDataUrl: string, pouring: string[], height: number) {
  const shown = days.slice(0, 7);
  const featured = pickFeatured(allScreenings);
  const contentW = PORTRAIT_W - P_PAD * 2;

  return (
    <div style={{ width: `${PORTRAIT_W}px`, height: `${height}px`, display: "flex", flexDirection: "column", backgroundColor: BG, padding: `${P_PAD}px`, gap: `${P_GAP}px`, fontFamily: SANS }}>
      <Masthead title="THIS WEEK'S LINEUP" rangeLabel={rangeLabel} width={contentW} height={P_MASTHEAD_H} />

      {/* Hero: one big poster, huge title treatment -- the primary eye-catcher */}
      <div style={{ display: "flex", flexDirection: "row", height: P_HERO_H, backgroundColor: SURFACE, border: `3px solid ${INK}`, borderRadius: 14, boxShadow: `8px 8px 0 ${ACCENT}` }}>
        {featured ? (
          <div style={{ display: "flex", flexDirection: "row", flex: 1 }}>
            <img src={featured.url} width={420} height={P_HERO_H} style={{ width: 420, height: P_HERO_H, objectFit: "cover", borderRadius: "11px 0 0 11px" }} />
            <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "28px 26px", justifyContent: "center", gap: 14 }}>
              <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 22, color: ACCENT, letterSpacing: 1.5 }}>THIS WEEK&apos;S PICK</div>
              <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 56, color: INK, lineHeight: 1 }}>{truncateTitle(featured.title, 16)}</div>
              <div style={{ display: "flex", flexDirection: "row", gap: 10 }}>
                <RatingBadge rating={featured.rating} size={22} />
                {featured.runtimeMinutes && (
                  <span style={{ display: "flex", fontFamily: MONO, fontSize: 22, color: MUTED, border: `1.5px solid ${BORDER}`, borderRadius: 6, padding: "4px 10px" }}>{featured.runtimeMinutes}m</span>
                )}
              </div>
              <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: 24, color: ACCENT, marginTop: 6 }}>Scan below for showtimes ↓</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontSize: 36, color: MUTED }}>ROYALE CINEMA LOUNGE</div>
        )}
      </div>

      {/* 7 days -- each band's height is set explicitly from the same
          estimateDayHeight() used to size the overall canvas. Deliberately
          no `overflow: hidden` here -- content is already length-capped
          (P_DAY_MAX_LINES) so nothing needs clipping, and an overflow clip
          on all 7 of these boxes was the single largest render-time cost in
          this file. See the HalftoneOverlay comment above for why. */}
      {shown.map((day, i) => {
        const header = DAY_HEADERS[i % DAY_HEADERS.length];
        const lines = groupDayEntries(day.entries);
        const dayHeight = estimateDayHeight(day);
        const overflowCount = lines.length - P_DAY_MAX_LINES;
        return (
          <div key={day.dateKey} style={{ display: "flex", flexDirection: "column", height: dayHeight, backgroundColor: SURFACE, border: `2.5px solid ${INK}`, borderRadius: 12 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: header.bg, padding: "0 22px", height: P_DAY_HEADER_H }}>
              <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 42, color: header.fg }}>{day.weekday}</div>
              <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 22, color: header.fg, opacity: 0.75 }}>{day.dateLabel}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: lines.length === 0 ? "center" : "flex-start", alignItems: lines.length === 0 ? "center" : "stretch", padding: "16px 22px", gap: "14px" }}>
              {lines.length === 0 ? (
                <ClosedTag />
              ) : (
                lines.slice(0, P_DAY_MAX_LINES).map((line, li) => <GroupedLineView key={li} line={line} titleSize={42} timeSize={26} />)
              )}
              {overflowCount > 0 && (
                <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 20, color: MUTED }}>+{overflowCount} MORE -- see site</div>
              )}
            </div>
          </div>
        );
      })}

      {/* Promo row */}
      <div style={{ display: "flex", flexDirection: "row", gap: 16, height: P_PROMO_H }}>
        <MembershipStamp />
        <BoothChip />
      </div>
      <div style={{ display: "flex", backgroundColor: SURFACE, border: `2.5px solid ${BORDER}`, borderRadius: 12, padding: "16px 22px" }}>
        <NowPouring items={pouring} />
      </div>

      <Footer qrDataUrl={qrDataUrl} />
    </div>
  );
}

// A handful of coffee-bar drinks worth naming -- generic drink types
// (Drip coffee, Espresso, Latte...) are filtered out in favor of the
// specifically movie-themed ones (City of Stars, Oppenheimer, Titanic...),
// which are the charming detail actually worth surfacing here.
const GENERIC_DRINK_NAMES = new Set(["drip coffee", "espresso", "latte", "cappuccino", "cortado", "americano", "batch brew"]);

async function getNowPouring(supabase: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await supabase
    .from("menu_items")
    .select("name, category:menu_categories!inner(key)")
    .eq("active", true)
    .in("category.key", ["caffe", "cocktails"]);
  const rows = (data ?? []) as unknown as { name: string; category: { key: string } }[];
  const named = rows.filter((i) => !GENERIC_DRINK_NAMES.has(i.name.toLowerCase()));
  // The coffee bar's movie-punned drinks (City of Stars, Oppenheimer,
  // Titanic...) are the more delightful, on-theme detail for a movie
  // schedule -- lead with those, fill any remaining slots with cocktails.
  const coffee = named.filter((i) => i.category.key === "caffe");
  const cocktails = named.filter((i) => i.category.key === "cocktails");
  return [...coffee, ...cocktails].slice(0, 4).map((i) => i.name.toUpperCase());
}

export async function GET(request: NextRequest) {
  const session = await getStaffSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const formatParam = searchParams.get("format");
  const format = formatParam === "banner" ? "banner" : formatParam === "portrait" ? "portrait" : "grid";
  const rangeLabel = searchParams.get("label") ?? "";
  const note = searchParams.get("note") ?? "";
  const rangeStart = searchParams.get("start");
  const rangeDays = Math.max(1, Math.min(14, parseInt(searchParams.get("days") ?? "0", 10) || 0));
  const screeningIds = (searchParams.get("screeningIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const eventIds = (searchParams.get("eventIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const noteIds = (searchParams.get("noteIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const supabase = createAdminClient();
  const [screeningsRes, eventsRes, notesRes, qrDataUrl] = await Promise.all([
    screeningIds.length > 0
      ? supabase.from("screenings").select("id, starts_at, movie:movies(title, poster_url, runtime_minutes, rating), room:rooms(name)").in("id", screeningIds).order("starts_at")
      : Promise.resolve({ data: [] as ScreeningRow[], error: null }),
    eventIds.length > 0
      ? supabase.from("events").select("id, event_name, event_date, event_time, hours, room:rooms(name)").in("id", eventIds)
      : Promise.resolve({ data: [] as EventRow[], error: null }),
    noteIds.length > 0
      ? supabase.from("calendar_notes").select("id, note_date, start_time, end_time, label").in("id", noteIds)
      : Promise.resolve({ data: [] as NoteRow[], error: null }),
    QRCode.toDataURL(`${SITE_URL}/showtimes`, { margin: 1, width: 280, color: { dark: INK, light: SURFACE } }),
  ]);
  if (screeningsRes.error) return new Response("Failed to load screenings", { status: 500 });
  if (eventsRes.error) return new Response("Failed to load events", { status: 500 });
  if (notesRes.error) return new Response("Failed to load notes", { status: 500 });

  const screenings = (screeningsRes.data ?? []) as unknown as ScreeningRow[];
  const events = (eventsRes.data ?? []) as unknown as EventRow[];
  const notes = (notesRes.data ?? []) as unknown as NoteRow[];
  const days = groupByDay(screenings, events, notes, rangeStart, rangeDays);
  const pouring = await getNowPouring(supabase);
  const fonts = await fontsPromise;

  if (format === "banner") {
    return new ImageResponse(renderBanner(days, screenings, rangeLabel, qrDataUrl), { width: 1200, height: 628, fonts });
  }
  if (format === "portrait") {
    const height = estimatePortraitHeight(days);
    return new ImageResponse(renderPortrait(days, screenings, rangeLabel, qrDataUrl, pouring, height), { width: PORTRAIT_W, height, fonts });
  }
  return new ImageResponse(await renderGrid(days, screenings, rangeLabel, note, qrDataUrl, pouring), { width: 1920, height: 1080, fonts });
}
