import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { isRestrictedRelease } from "@/lib/data/screenings";
import {
  FLYER_W,
  QR_DARK,
  QR_LIGHT,
  buildFlyerModel,
  fitFlyer,
  renderFlyer,
  loadFonts,
  loadLogo,
  type ScreeningRow,
  type EventRow,
  type NoteRow,
} from "./render";

export const runtime = "nodejs";

interface ScreeningWithYear extends ScreeningRow {
  movie: (NonNullable<ScreeningRow["movie"]> & { release_year: number | null }) | null;
}

export async function GET(request: NextRequest) {
  const session = await getStaffSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  // "public" is the safe default: only current-year releases, which is all
  // our MPLC license lets us advertise. "members" adds the older titles for
  // the Insiders email list (which is allowed -- they're being informed, not
  // advertised to) and marks the image itself as members-only in case it's
  // ever forwarded.
  const audience = searchParams.get("audience") === "members" ? "members" : "public";
  const rangeLabel = searchParams.get("label") ?? "";
  const note = searchParams.get("note") ?? "";
  const rangeStart = searchParams.get("start");
  const rangeDays = Math.max(1, Math.min(14, parseInt(searchParams.get("days") ?? "0", 10) || 0));
  const screeningIds = (searchParams.get("screeningIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const eventIds = (searchParams.get("eventIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const noteIds = (searchParams.get("noteIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const supabase = createAdminClient();
  const [screeningsRes, eventsRes, notesRes, qrDataUrl, fonts, logoDataUrl] = await Promise.all([
    screeningIds.length > 0
      ? supabase
          .from("screenings")
          .select("id, starts_at, movie:movies(title, poster_url, runtime_minutes, rating, release_year), room:rooms(name)")
          .in("id", screeningIds)
          .order("starts_at")
      : Promise.resolve({ data: [] as ScreeningWithYear[], error: null }),
    eventIds.length > 0
      ? supabase.from("events").select("id, event_name, event_date, event_time, hours, room:rooms(name)").in("id", eventIds)
      : Promise.resolve({ data: [] as EventRow[], error: null }),
    noteIds.length > 0
      ? supabase.from("calendar_notes").select("id, note_date, start_time, end_time, label").in("id", noteIds)
      : Promise.resolve({ data: [] as NoteRow[], error: null }),
    QRCode.toDataURL(`${SITE_URL}/showtimes`, { margin: 1, width: 280, color: { dark: QR_DARK, light: QR_LIGHT } }),
    loadFonts(),
    loadLogo(),
  ]);
  if (screeningsRes.error) return new Response("Failed to load screenings", { status: 500 });
  if (eventsRes.error) return new Response("Failed to load events", { status: 500 });
  if (notesRes.error) return new Response("Failed to load notes", { status: 500 });

  // Enforced here, not just in the builder's checklist -- the ids in the URL
  // are whatever the browser sent. For members, the older titles are still
  // split out into the flyer's own "film archive" section.
  const screenings: ScreeningRow[] = ((screeningsRes.data ?? []) as unknown as ScreeningWithYear[])
    .filter((s) => s.movie && (audience === "members" || !isRestrictedRelease(s.movie)))
    .map((s) => ({ ...s, movie: s.movie && { ...s.movie, archive: isRestrictedRelease(s.movie) } }));
  const events = (eventsRes.data ?? []) as unknown as EventRow[];
  const notes = (notesRes.data ?? []) as unknown as NoteRow[];

  const model = buildFlyerModel(screenings, events, notes, rangeStart, rangeDays);
  const opts = {
    headline: rangeDays === 7 ? "THIS WEEK" : "COMING UP",
    rangeLabel,
    note,
    membersEdition: audience === "members",
    qrDataUrl,
    logoDataUrl,
  };
  const layout = fitFlyer(model, opts);
  return new ImageResponse(renderFlyer(layout, model, opts), { width: FLYER_W, height: layout.height, fonts });
}
