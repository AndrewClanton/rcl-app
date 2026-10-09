import { NextResponse, type NextRequest } from "next/server";
import { syncFromGoogleDrive } from "@/lib/calendar-auto";

// Vercel calls this hourly (vercel.json): the staff calendar is pulled from
// the connected Google Drive and the schedule follows it
// (src/lib/calendar-auto.ts). Does nothing until Google Drive is connected
// on Back office > Showtimes > Sync from calendar. With CRON_SECRET set in
// Vercel, only Vercel's own call gets through.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const r = await syncFromGoogleDrive();
  return NextResponse.json("skipped" in r ? r : { ok: r.status.ok, added: r.status.added, changed: r.status.changed, removed: r.status.removed, flagged: r.status.flagged, error: r.status.error ?? null });
}
