import { NextResponse, type NextRequest } from "next/server";
import { businessDay, shiftDate } from "@/lib/ops/time";
import { sendDailyReport } from "@/lib/daily-report";

// Vercel calls this every morning (vercel.json) to email the admins the
// business day that just ended. With CRON_SECRET set in Vercel, only
// Vercel's own call gets through; either way each day is sent only once.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  // Runs after the 4 AM rollover, so "today" has just begun: report yesterday.
  const date = shiftDate(businessDay().date, -1);
  const origin = new URL(req.url).origin;
  const result = await sendDailyReport(date, origin);
  return NextResponse.json({ date, ...result });
}
