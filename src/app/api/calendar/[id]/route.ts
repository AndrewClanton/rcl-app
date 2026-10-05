import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL, SITE_NAME } from "@/lib/site";

// "Add to my calendar" for a house event (trivia, comedy, the book swap),
// linked from event emails: a one-event .ics file that Apple, Google and
// Outlook calendars all open. House events are public; private bookings
// (the `events` table) are never read here.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Text values: escape backslashes, semicolons, commas and newlines.
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const { data: e } = await createAdminClient().from("house_events").select("id, title, note, starts_at, ends_at").eq("id", id).maybeSingle();
  if (!e) return new Response("Not found", { status: 404 });
  const end = e.ends_at ?? new Date(Date.parse(e.starts_at) + 2 * 3_600_000).toISOString();
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${SITE_NAME}//House events//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@royalecinemajoplin.com`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.starts_at)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`${e.title} at Royale Cinema`)}`,
    `LOCATION:${text("Royale Cinema Lounge, 715 E Broadway, Joplin, MO 64801")}`,
    ...(e.note ? [`DESCRIPTION:${text(e.note)}`] : []),
    `URL:${SITE_URL}/showtimes`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="royale-${e.id.slice(0, 8)}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
