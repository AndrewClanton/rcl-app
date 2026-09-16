import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CENTRAL_TZ = "America/Chicago";
const BG = "#0b0a0f";
const SURFACE = "#16131c";
const BORDER = "#2c2632";
const FOREGROUND = "#f4ede0";
const MUTED = "#a79b8c";
const ACCENT = "#d3a24a";
const ACCENT_FG = "#1a1206";
const TEAL = "#3a8c85";
const MAGENTA = "#b24f7e";
const WARN_BG = "#241c0d";
const WARN_BORDER = "#6b4f1a";
const WARN_TEXT = "#f0c568";
const OUTDOOR_BG = "#10241a";
const OUTDOOR_BORDER = "#2c5c3f";
const OUTDOOR_TEXT = "#8fe3ab";
const NOTE_BG = "#1c1c24";
const NOTE_BORDER = "#3c3c48";
const NOTE_TEXT = "#c7c7d4";

const DAY_HEADER_COLORS = [ACCENT, TEAL, MAGENTA];

// Fonts don't depend on request data -- read once at module scope (Next's
// own recommendation for ImageResponse) rather than on every request.
const FONTS_DIR = join(process.cwd(), "src/app/admin/schedule-graphic/fonts");
const fontsPromise = Promise.all([
  readFile(join(FONTS_DIR, "PlayfairDisplay-Bold.ttf")),
  readFile(join(FONTS_DIR, "PlayfairDisplay-SemiBold.ttf")),
  readFile(join(FONTS_DIR, "Inter-Regular.ttf")),
  readFile(join(FONTS_DIR, "Inter-SemiBold.ttf")),
  readFile(join(FONTS_DIR, "Inter-ExtraBold.ttf")),
]).then(([playfairBold, playfairSemi, interReg, interSemi, interExtra]) => [
  { name: "Playfair Display", data: playfairBold, weight: 700 as const, style: "normal" as const },
  { name: "Playfair Display", data: playfairSemi, weight: 600 as const, style: "normal" as const },
  { name: "Inter", data: interReg, weight: 400 as const, style: "normal" as const },
  { name: "Inter", data: interSemi, weight: 600 as const, style: "normal" as const },
  { name: "Inter", data: interExtra, weight: 800 as const, style: "normal" as const },
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

function uniquePosters(screenings: ScreeningRow[]): { title: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const s of screenings) {
    if (s.movie?.poster_path && !seen.has(s.movie.title)) {
      seen.set(s.movie.title, `https://image.tmdb.org/t/p/w185${s.movie.poster_path}`);
    }
  }
  return [...seen.entries()].slice(0, 10).map(([title, url]) => ({ title, url }));
}

function EntryLine({ entry }: { entry: DayEntry }) {
  if (entry.kind === "event") {
    return (
      <div style={{ display: "flex", flexDirection: "column", backgroundColor: WARN_BG, border: `1px solid ${WARN_BORDER}`, borderRadius: 5, padding: "4px 7px" }}>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 15, color: WARN_TEXT }}>
          {entry.time} {entry.title}
        </div>
        {entry.sub && <div style={{ display: "flex", fontFamily: "Inter", fontSize: 11, color: MUTED }}>{entry.sub}</div>}
      </div>
    );
  }
  if (entry.kind === "note") {
    return (
      <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 14, fontStyle: "italic", color: NOTE_TEXT, backgroundColor: NOTE_BG, border: `1px solid ${NOTE_BORDER}`, borderRadius: 5, padding: "4px 7px" }}>
        {entry.time ? `${entry.time}: ` : ""}{entry.title}
      </div>
    );
  }
  if (entry.outdoor) {
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: OUTDOOR_BG, border: `1px solid ${OUTDOOR_BORDER}`, borderRadius: 5, padding: "4px 7px" }}>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 16, color: OUTDOOR_TEXT }}>
          {entry.time}: {entry.title}
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 10.5, color: BG, backgroundColor: OUTDOOR_TEXT, borderRadius: 3, padding: "1px 5px", letterSpacing: 0.5 }}>
          OUTDOOR
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 16, color: FOREGROUND, padding: "1px 2px" }}>
      {entry.time}: {entry.title}
    </div>
  );
}

function DayCell({ day, colorIndex }: { day: DayGroup; colorIndex: number }) {
  const headerColor = DAY_HEADER_COLORS[colorIndex % DAY_HEADER_COLORS.length];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 8, backgroundColor: headerColor, padding: "8px 12px" }}>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 17, color: ACCENT_FG }}>{day.weekday}</div>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 14, color: ACCENT_FG, opacity: 0.75 }}>{day.dateLabel}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: day.entries.length === 0 ? "center" : "flex-start", alignItems: day.entries.length === 0 ? "center" : "stretch", padding: "8px 10px", gap: "4px" }}>
        {day.entries.length === 0 ? (
          <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 30, color: MUTED }}>CLOSED</div>
        ) : (
          day.entries.map((entry, i) => <EntryLine key={i} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function renderGrid(days: DayGroup[], allScreenings: ScreeningRow[], rangeLabel: string, note: string) {
  const posters = uniquePosters(allScreenings);
  const gridDays = days.slice(0, 7);
  const firstRow = gridDays.slice(0, 4);
  const secondRow = gridDays.slice(4, 7);

  return (
    <div style={{ width: "1920px", height: "1080px", display: "flex", flexDirection: "column", backgroundColor: BG, padding: "28px 34px", fontFamily: "Inter" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 46, color: ACCENT, textAlign: "center" }}>
          ROYALE INSIDERS MOVIE LINEUP
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 16, color: MUTED, marginTop: 2 }}>{rangeLabel}</div>
      </div>

      {posters.length > 0 && (
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: "10px", marginBottom: 16 }}>
          {posters.map((p) => (
            <img key={p.title} src={p.url} width={72} height={108} style={{ width: 72, height: 108, borderRadius: 5, objectFit: "cover", border: `1px solid ${BORDER}` }} />
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "row", gap: "12px", flex: 1 }}>
          {firstRow.map((day, i) => (
            <DayCell key={day.dateKey} day={day} colorIndex={i} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: "12px", flex: 1 }}>
          {secondRow.map((day, i) => (
            <DayCell key={day.dateKey} day={day} colorIndex={i + 4} />
          ))}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: SURFACE, border: `1px solid ${ACCENT}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", backgroundColor: ACCENT, padding: "8px 12px" }}>
              <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 17, color: ACCENT_FG }}>PLAN AHEAD</div>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 14px" }}>
              {note ? (
                <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 600, fontSize: 20, color: FOREGROUND, textAlign: "center" }}>{note}</div>
              ) : (
                <div style={{ display: "flex", fontFamily: "Inter", fontSize: 14, color: MUTED, textAlign: "center" }}>—</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", marginTop: 14, fontFamily: "Inter", fontSize: 14, color: MUTED }}>
        715 E Broadway, Joplin, MO · 417-281-4172
      </div>
    </div>
  );
}

function renderBanner(days: DayGroup[], rangeLabel: string) {
  const shown = days.slice(0, 7);
  return (
    <div style={{ width: "1200px", height: "628px", display: "flex", flexDirection: "column", backgroundColor: BG, fontFamily: "Inter" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", padding: "26px 40px 16px", borderBottom: `2px solid ${BORDER}` }}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: "14px" }}>
          <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 30, color: FOREGROUND }}>Royale Cinema Lounge</div>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 14, color: ACCENT }}>THIS WEEK</div>
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 15, color: MUTED }}>{rangeLabel}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "16px 24px" }}>
        {shown.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontSize: 20, color: MUTED }}>No days selected</div>
        ) : (
          shown.map((day) => (
            <div key={day.dateKey} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "0 8px", borderLeft: `1px solid ${BORDER}`, gap: "4px" }}>
              <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 12, color: ACCENT }}>{day.weekday.slice(0, 3)}</div>
              <div style={{ display: "flex", fontFamily: "Inter", fontSize: 10, color: MUTED, marginBottom: 4 }}>{day.dateLabel}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                {day.entries.length === 0 ? (
                  <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 13, color: MUTED }}>CLOSED</div>
                ) : (
                  day.entries.map((entry, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        fontFamily: "Inter",
                        fontStyle: entry.kind === "note" ? "italic" : "normal",
                        fontWeight: entry.kind === "event" || entry.kind === "note" || entry.outdoor ? 700 : 400,
                        fontSize: 10.5,
                        color: entry.kind === "event" ? WARN_TEXT : entry.kind === "note" ? NOTE_TEXT : entry.outdoor ? OUTDOOR_TEXT : FOREGROUND,
                      }}
                    >
                      {entry.time} {entry.title}
                      {entry.outdoor ? " (OUT)" : ""}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", padding: "12px 0 18px", borderTop: `2px solid ${BORDER}`, fontFamily: "Inter", fontSize: 13, color: MUTED }}>
        715 E Broadway, Joplin, MO · 417-281-4172
      </div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const session = await getStaffSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const format = searchParams.get("format") === "banner" ? "banner" : "grid";
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

  return new ImageResponse(format === "banner" ? renderBanner(days, rangeLabel) : renderGrid(days, screenings, rangeLabel, note), {
    width: format === "banner" ? 1200 : 1920,
    height: format === "banner" ? 628 : 1080,
    fonts,
  });
}
