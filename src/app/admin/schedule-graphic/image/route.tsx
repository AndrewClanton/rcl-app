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
const WARN_BG = "#241c0d";
const WARN_BORDER = "#6b4f1a";
const WARN_TEXT = "#f0c568";

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
  movie: { title: string } | null;
}
interface EventRow {
  id: string;
  event_name: string;
  event_date: string;
  event_time: string;
  hours: number;
  room: { name: string } | null;
}

interface DayEntry {
  kind: "screening" | "event";
  label: string; // "7:00 PM · Coyote vs. Acme" or "6:00–9:00 PM · Private event"
  sub?: string; // room name, for events
}
interface DayGroup {
  dateKey: string;
  heading: string;
  entries: DayEntry[];
}

function centralDateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function dayHeadingFromKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
}

function screeningTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CENTRAL_TZ, hour: "numeric", minute: "2-digit" });
}

// event_time is a bare "HH:MM:SS" (no timezone -- it's a wall-clock time
// entered by staff for the venue itself, not a UTC instant), so this is
// plain arithmetic, not a timezone conversion.
function eventTimeRange(time: string, hours: number) {
  const [h, m] = time.split(":").map(Number);
  const startMinutes = h * 60 + m;
  const endMinutes = startMinutes + Math.round(hours * 60);
  const fmt = (total: number) => {
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    const period = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${hour12}:${String(mm).padStart(2, "0")} ${period}`;
  };
  return `${fmt(startMinutes)}–${fmt(endMinutes)}`;
}

function groupByDay(screenings: ScreeningRow[], events: EventRow[]): DayGroup[] {
  const byDay = new Map<string, DayGroup>();
  function ensure(dateKey: string): DayGroup {
    let g = byDay.get(dateKey);
    if (!g) {
      g = { dateKey, heading: dayHeadingFromKey(dateKey), entries: [] };
      byDay.set(dateKey, g);
    }
    return g;
  }

  for (const s of screenings) {
    if (!s.movie) continue;
    const key = centralDateKey(s.starts_at);
    ensure(key).entries.push({ kind: "screening", label: `${screeningTime(s.starts_at)} · ${s.movie.title}` });
  }
  for (const e of events) {
    ensure(e.event_date).entries.push({
      kind: "event",
      label: `${eventTimeRange(e.event_time, e.hours)} · ${e.event_name}`,
      sub: e.room?.name,
    });
  }

  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function EntryRow({ entry, compact = false }: { entry: DayEntry; compact?: boolean }) {
  if (entry.kind === "event") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: WARN_BG,
          border: `1px solid ${WARN_BORDER}`,
          borderRadius: 6,
          padding: compact ? "5px 8px" : "7px 12px",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: compact ? 12 : 17, color: WARN_TEXT }}>
          {entry.label}
        </div>
        {entry.sub && !compact && (
          <div style={{ display: "flex", fontFamily: "Inter", fontSize: 13, color: MUTED }}>{entry.sub}</div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 400, fontSize: compact ? 12 : 19, color: FOREGROUND }}>
      {entry.label}
    </div>
  );
}

function renderPoster(days: DayGroup[], rangeLabel: string) {
  return (
    <div style={{ width: "1080px", height: "1350px", display: "flex", flexDirection: "column", backgroundColor: BG, fontFamily: "Inter" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 60px 24px", borderBottom: `2px solid ${BORDER}` }}>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 18, letterSpacing: 4, color: ACCENT }}>
          ROYALE CINEMA LOUNGE
        </div>
        <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 46, color: FOREGROUND, marginTop: 10 }}>
          This Week&apos;s Schedule
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 18, color: MUTED, marginTop: 6 }}>{rangeLabel}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "22px 52px", gap: "16px" }}>
        {days.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontSize: 22, color: MUTED }}>
            No days selected
          </div>
        ) : (
          days.map((day) => (
            <div key={day.dateKey} style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: "Inter",
                  fontWeight: 800,
                  fontSize: 15,
                  letterSpacing: 1,
                  color: ACCENT,
                  textTransform: "uppercase",
                  borderBottom: `1px solid ${BORDER}`,
                  paddingBottom: 6,
                  marginBottom: 8,
                }}
              >
                {day.heading}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {day.entries.map((entry, i) => (
                  <EntryRow key={i} entry={entry} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 0 40px", borderTop: `2px solid ${BORDER}` }}>
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 17, color: FOREGROUND }}>715 E Broadway, Joplin, MO</div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 14, color: MUTED, marginTop: 5 }}>417-281-4172 · royalecinemajoplin.com</div>
      </div>
    </div>
  );
}

function renderBanner(days: DayGroup[], rangeLabel: string) {
  const shown = days.slice(0, 7);
  return (
    <div style={{ width: "1200px", height: "628px", display: "flex", flexDirection: "column", backgroundColor: BG, fontFamily: "Inter" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "26px 40px 16px",
          borderBottom: `2px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: "14px" }}>
          <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 30, color: FOREGROUND }}>
            Royale Cinema Lounge
          </div>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 14, color: ACCENT }}>THIS WEEK</div>
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 15, color: MUTED }}>{rangeLabel}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "row", padding: "16px 24px" }}>
        {shown.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontSize: 20, color: MUTED }}>
            No days selected
          </div>
        ) : (
          shown.map((day) => (
            <div
              key={day.dateKey}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                padding: "0 8px",
                borderLeft: `1px solid ${BORDER}`,
                gap: "5px",
              }}
            >
              <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 12, color: ACCENT, textTransform: "uppercase" }}>
                {day.heading.split(",")[0]}
              </div>
              <div style={{ display: "flex", fontFamily: "Inter", fontSize: 10, color: MUTED, marginBottom: 4 }}>
                {day.heading.split(",")[1]?.trim()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {day.entries.length === 0 ? (
                  <div style={{ display: "flex", fontFamily: "Inter", fontSize: 11, color: MUTED }}>—</div>
                ) : (
                  day.entries.map((entry, i) => <EntryRow key={i} entry={entry} compact />)
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "center",
          padding: "12px 0 18px",
          borderTop: `2px solid ${BORDER}`,
          fontFamily: "Inter",
          fontSize: 13,
          color: MUTED,
        }}
      >
        715 E Broadway, Joplin, MO · 417-281-4172
      </div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const session = await getStaffSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const format = searchParams.get("format") === "banner" ? "banner" : "poster";
  const rangeLabel = searchParams.get("label") ?? "";
  const screeningIds = (searchParams.get("screeningIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const eventIds = (searchParams.get("eventIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const supabase = createAdminClient();
  const [screeningsRes, eventsRes] = await Promise.all([
    screeningIds.length > 0
      ? supabase.from("screenings").select("id, starts_at, movie:movies(title)").in("id", screeningIds).order("starts_at")
      : Promise.resolve({ data: [] as ScreeningRow[], error: null }),
    eventIds.length > 0
      ? supabase.from("events").select("id, event_name, event_date, event_time, hours, room:rooms(name)").in("id", eventIds)
      : Promise.resolve({ data: [] as EventRow[], error: null }),
  ]);
  if (screeningsRes.error) return new Response("Failed to load screenings", { status: 500 });
  if (eventsRes.error) return new Response("Failed to load events", { status: 500 });

  const days = groupByDay((screeningsRes.data ?? []) as unknown as ScreeningRow[], (eventsRes.data ?? []) as unknown as EventRow[]);
  const fonts = await fontsPromise;

  return new ImageResponse(format === "banner" ? renderBanner(days, rangeLabel) : renderPoster(days, rangeLabel), {
    width: format === "banner" ? 1200 : 1080,
    height: format === "banner" ? 628 : 1350,
    fonts,
  });
}
