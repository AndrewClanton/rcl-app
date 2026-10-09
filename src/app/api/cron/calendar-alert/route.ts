import { NextResponse, type NextRequest } from "next/server";
import { runCalendarAlert } from "@/lib/calendar-alert";

// Vercel calls this every 15 minutes (vercel.json): emails the owners and
// admins when the schedule hasn't been checked against the calendar in an
// hour (at most every 3 hours), and once when it's back
// (src/lib/calendar-alert.ts). With CRON_SECRET set in Vercel, only
// Vercel's own call gets through.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runCalendarAlert(new URL(req.url).origin));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
