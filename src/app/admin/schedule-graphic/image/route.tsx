import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CENTRAL_TZ = "America/Chicago";

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
  movie: { title: string; poster_path: string | null } | null;
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
  sub?: string; // room name, for events
}
interface DayGroup {
  dateKey: string;
  weekday: string;
  dateLabel: string;
  entries: DayEntry[];
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
    .toLocaleTimeString("en-US", { timeZone: CENTRAL_TZ, hour: "2-digit", minute: "2-digit" })
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
    return `${String(hour12).padStart(2, "0")}:${String(mm).padStart(2, "0")}${period}`;
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
    return `${String(hour12).padStart(2, "0")}:${String(mm).padStart(2, "0")}${period}`;
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

function uniquePosters(screenings: ScreeningRow[], limit: number): { title: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const s of screenings) {
    if (s.movie?.poster_path && !seen.has(s.movie.title)) {
      seen.set(s.movie.title, `https://image.tmdb.org/t/p/w185${s.movie.poster_path}`);
    }
  }
  return [...seen.entries()].slice(0, limit).map(([title, url]) => ({ title, url }));
}

// A closed/empty day reads as a small, deliberate tag instead of a lone
// giant word floating in a sea of blank space -- the actual fix for "too
// much dead space" on light days, since there's no real content to pad it
// out with.
function ClosedTag({ size = "md" }: { size?: "sm" | "md" }) {
  const fontSize = size === "sm" ? 11 : 13;
  return (
    <div
      style={{
        display: "flex",
        fontFamily: DISPLAY,
        fontSize,
        letterSpacing: 1,
        color: MUTED,
        border: `1.5px solid ${BORDER}`,
        borderRadius: 4,
        padding: size === "sm" ? "3px 8px" : "4px 10px",
      }}
    >
      CLOSED
    </div>
  );
}

function EntryLine({ entry, compact = false }: { entry: DayEntry; compact?: boolean }) {
  const timeSize = compact ? 11 : 13;
  const titleSize = compact ? 12.5 : 15;
  if (entry.kind === "event") {
    return (
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: WARN_BG, border: `1px solid ${WARN_BORDER}`, borderRadius: 5, padding: "4px 8px" }}>
        <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: titleSize, color: WARN_TEXT }}>
          <span style={{ fontFamily: MONO, marginRight: 6 }}>{entry.time}</span>
          {entry.title}
        </div>
        {entry.sub && !compact && <div style={{ display: "flex", fontFamily: SANS, fontSize: 10.5, color: MUTED }}>{entry.sub}</div>}
      </div>
    );
  }
  if (entry.kind === "note") {
    return (
      <div
        style={{
          display: "flex",
          fontFamily: SANS,
          fontWeight: 600,
          fontStyle: "italic",
          fontSize: titleSize,
          color: NOTE_TEXT,
          backgroundColor: SURFACE_HOVER,
          border: `1px solid ${BORDER}`,
          borderRadius: 5,
          padding: "4px 8px",
        }}
      >
        {entry.time && <span style={{ fontFamily: MONO, fontStyle: "normal", marginRight: 6 }}>{entry.time}</span>}
        {entry.title}
      </div>
    );
  }
  if (entry.outdoor) {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: SURFACE, border: `1.5px solid ${INK}`, borderRadius: 5, padding: "4px 8px" }}>
        <span style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: timeSize, color: INK }}>{entry.time}</span>
        <span style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: titleSize, color: INK }}>{entry.title}</span>
        <span style={{ display: "flex", fontFamily: DISPLAY, fontSize: 9.5, color: GOLD_FG, backgroundColor: GOLD, borderRadius: 3, padding: "2px 5px", letterSpacing: 0.4 }}>
          OUTDOOR
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 6, padding: "2px 3px" }}>
      <span style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: timeSize, color: ACCENT }}>{entry.time}</span>
      <span style={{ display: "flex", fontFamily: SANS, fontWeight: 600, fontSize: titleSize, color: INK }}>{entry.title}</span>
    </div>
  );
}

function DayCell({ day, colorIndex }: { day: DayGroup; colorIndex: number }) {
  const header = DAY_HEADERS[colorIndex % DAY_HEADERS.length];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `1.5px solid ${INK}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 8, backgroundColor: header.bg, padding: "7px 12px" }}>
        <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 15, color: header.fg }}>{day.weekday}</div>
        <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 12, color: header.fg, opacity: 0.75 }}>{day.dateLabel}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: day.entries.length === 0 ? "center" : "stretch", padding: "9px 10px", gap: "5px" }}>
        {day.entries.length === 0 ? <ClosedTag /> : day.entries.map((entry, i) => <EntryLine key={i} entry={entry} />)}
      </div>
    </div>
  );
}

function GraphicHeader({ title, rangeLabel }: { title: string; rangeLabel: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 12, letterSpacing: 2, color: ACCENT }}>JOPLIN, MO</div>
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 38, color: INK, textAlign: "center", marginTop: 2 }}>{title}</div>
      <div style={{ display: "flex", fontFamily: MONO, fontSize: 14, color: MUTED, marginTop: 3 }}>{rangeLabel}</div>
    </div>
  );
}

function GraphicFooter({ fontSize = 13 }: { fontSize?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", fontFamily: MONO, fontSize, color: MUTED }}>
      715 E BROADWAY, JOPLIN MO · 417-281-4172
    </div>
  );
}

function renderGrid(days: DayGroup[], allScreenings: ScreeningRow[], rangeLabel: string, note: string) {
  const posters = uniquePosters(allScreenings, 10);
  const gridDays = days.slice(0, 7);
  const firstRow = gridDays.slice(0, 4);
  const secondRow = gridDays.slice(4, 7);

  return (
    <div style={{ width: "1920px", height: "1080px", display: "flex", flexDirection: "column", backgroundColor: BG, padding: "22px 30px", fontFamily: SANS }}>
      <GraphicHeader title="ROYALE INSIDERS MOVIE LINEUP" rangeLabel={rangeLabel} />

      {posters.length > 0 && (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: "8px", margin: "10px 0" }}>
          {posters.map((p) => (
            <img key={p.title} src={p.url} width={58} height={87} style={{ width: 58, height: 87, borderRadius: 4, objectFit: "cover", border: `1.5px solid ${INK}` }} />
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px", marginTop: posters.length > 0 ? 0 : 14 }}>
        <div style={{ display: "flex", flexDirection: "row", gap: "10px", flex: 1 }}>
          {firstRow.map((day, i) => (
            <DayCell key={day.dateKey} day={day} colorIndex={i} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: "10px", flex: 1 }}>
          {secondRow.map((day, i) => (
            <DayCell key={day.dateKey} day={day} colorIndex={i + 4} />
          ))}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `1.5px solid ${ACCENT}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", backgroundColor: ACCENT, padding: "7px 12px" }}>
              <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 15, color: ACCENT_FG }}>PLAN AHEAD</div>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 14px" }}>
              {note ? (
                <div style={{ display: "flex", fontFamily: SANS, fontWeight: 700, fontSize: 18, color: INK, textAlign: "center" }}>{note}</div>
              ) : (
                <div style={{ display: "flex", fontFamily: MONO, fontSize: 13, color: MUTED, textAlign: "center" }}>—</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", marginTop: 14 }}>
        <GraphicFooter />
      </div>
    </div>
  );
}

function renderBanner(days: DayGroup[], rangeLabel: string) {
  const shown = days.slice(0, 7);
  return (
    <div style={{ width: "1200px", height: "628px", display: "flex", flexDirection: "column", backgroundColor: BG, fontFamily: SANS }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", padding: "22px 32px 14px", borderBottom: `2px solid ${INK}` }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: "12px" }}>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 24, color: INK }}>ROYALE CINEMA LOUNGE</div>
          <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 12, color: ACCENT }}>THIS WEEK</div>
        </div>
        <div style={{ display: "flex", fontFamily: MONO, fontSize: 13, color: MUTED }}>{rangeLabel}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "14px 20px" }}>
        {shown.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: SANS, fontSize: 18, color: MUTED }}>No days selected</div>
        ) : (
          shown.map((day, i) => (
            <div key={day.dateKey} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 8px", borderLeft: i === 0 ? "none" : `1px solid ${BORDER}`, gap: "3px" }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 5 }}>
                <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 13, color: ACCENT }}>{day.weekday.slice(0, 3)}</div>
                <div style={{ display: "flex", fontFamily: MONO, fontSize: 10, color: MUTED }}>{day.dateLabel}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: "4px", marginTop: 2 }}>
                {day.entries.length === 0 ? (
                  <ClosedTag size="sm" />
                ) : (
                  day.entries.map((entry, i2) => (
                    <div
                      key={i2}
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 4,
                        fontFamily: SANS,
                        fontStyle: entry.kind === "note" ? "italic" : "normal",
                        fontWeight: entry.kind === "event" || entry.kind === "note" || entry.outdoor ? 700 : 600,
                        fontSize: 10.5,
                        color: entry.kind === "event" ? WARN_TEXT : entry.kind === "note" ? NOTE_TEXT : INK,
                      }}
                    >
                      <span style={{ display: "flex", fontFamily: MONO, color: entry.outdoor ? GOLD_FG : ACCENT }}>{entry.time}</span>
                      <span style={{ display: "flex" }}>
                        {entry.title}
                        {entry.outdoor ? " (OUT)" : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", padding: "10px 0 16px", borderTop: `2px solid ${INK}` }}>
        <GraphicFooter fontSize={12} />
      </div>
    </div>
  );
}

// Phone-friendly: 7 days stacked full-width instead of a grid of narrow
// columns, each getting an even share of the tall canvas (flex: 1) so a
// light day reads as intentionally calm rather than as a gap in the
// layout. Entries wrap left-to-right within a day's band instead of
// forcing one entry per line, using the width as well as the height.
function renderPortrait(days: DayGroup[], allScreenings: ScreeningRow[], rangeLabel: string) {
  const shown = days.slice(0, 7);
  const posters = uniquePosters(allScreenings, 6);

  return (
    <div style={{ width: "1080px", height: "1920px", display: "flex", flexDirection: "column", backgroundColor: BG, padding: "26px 26px 18px", fontFamily: SANS }}>
      <GraphicHeader title="ROYALE INSIDERS MOVIE LINEUP" rangeLabel={rangeLabel} />

      {posters.length > 0 && (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: "7px", margin: "12px 0 4px" }}>
          {posters.map((p) => (
            <img key={p.title} src={p.url} width={54} height={81} style={{ width: 54, height: 81, borderRadius: 4, objectFit: "cover", border: `1.5px solid ${INK}` }} />
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px", marginTop: 14 }}>
        {shown.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: SANS, fontSize: 20, color: MUTED }}>No days selected</div>
        ) : (
          shown.map((day, i) => {
            const header = DAY_HEADERS[i % DAY_HEADERS.length];
            return (
              <div key={day.dateKey} style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `1.5px solid ${INK}`, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 8, backgroundColor: header.bg, padding: "6px 14px" }}>
                  <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 16, color: header.fg }}>{day.weekday}</div>
                  <div style={{ display: "flex", fontFamily: MONO, fontWeight: 700, fontSize: 12, color: header.fg, opacity: 0.75 }}>{day.dateLabel}</div>
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignContent: "center",
                    justifyContent: day.entries.length === 0 ? "center" : "flex-start",
                    alignItems: day.entries.length === 0 ? "center" : "flex-start",
                    padding: "8px 12px",
                    gap: "6px",
                  }}
                >
                  {day.entries.length === 0 ? <ClosedTag /> : day.entries.map((entry, i2) => <EntryLine key={i2} entry={entry} compact />)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", marginTop: 12 }}>
        <GraphicFooter />
      </div>
    </div>
  );
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
  const [screeningsRes, eventsRes, notesRes] = await Promise.all([
    screeningIds.length > 0
      ? supabase.from("screenings").select("id, starts_at, movie:movies(title, poster_path), room:rooms(name)").in("id", screeningIds).order("starts_at")
      : Promise.resolve({ data: [] as ScreeningRow[], error: null }),
    eventIds.length > 0
      ? supabase.from("events").select("id, event_name, event_date, event_time, hours, room:rooms(name)").in("id", eventIds)
      : Promise.resolve({ data: [] as EventRow[], error: null }),
    noteIds.length > 0
      ? supabase.from("calendar_notes").select("id, note_date, start_time, end_time, label").in("id", noteIds)
      : Promise.resolve({ data: [] as NoteRow[], error: null }),
  ]);
  if (screeningsRes.error) return new Response("Failed to load screenings", { status: 500 });
  if (eventsRes.error) return new Response("Failed to load events", { status: 500 });
  if (notesRes.error) return new Response("Failed to load notes", { status: 500 });

  const screenings = (screeningsRes.data ?? []) as unknown as ScreeningRow[];
  const events = (eventsRes.data ?? []) as unknown as EventRow[];
  const notes = (notesRes.data ?? []) as unknown as NoteRow[];
  const days = groupByDay(screenings, events, notes, rangeStart, rangeDays);
  const fonts = await fontsPromise;

  const dims = format === "banner" ? { width: 1200, height: 628 } : format === "portrait" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const element =
    format === "banner" ? renderBanner(days, rangeLabel) : format === "portrait" ? renderPortrait(days, screenings, rangeLabel) : renderGrid(days, screenings, rangeLabel, note);

  return new ImageResponse(element, { ...dims, fonts });
}
