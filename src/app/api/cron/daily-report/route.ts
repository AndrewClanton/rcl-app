import { NextResponse, type NextRequest } from "next/server";
import { businessDay, shiftDate } from "@/lib/ops/time";
import { sendDailyReport } from "@/lib/daily-report";
import { runGiftMaintenance } from "@/lib/gift-membership";
import { syncMemberPayments } from "@/lib/membership-payments/sync";

// Vercel calls this every morning (vercel.json) to email the admins the
// business day that just ended. With CRON_SECRET set in Vercel, only
// Vercel's own call gets through; either way each day is sent only once.
export const dynamic = "force-dynamic";
// Reading member payments from Stripe first can take a few seconds (longer
// if a read from a Reports page is already going and this one waits).
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  // Runs after the 4 AM rollover, so "today" has just begun: report yesterday.
  const date = shiftDate(businessDay().date, -1);
  const origin = new URL(req.url).origin;
  // Gifted Insiders+ that ran out overnight goes off, and friends whose
  // gift ends in two weeks get a reminder. Never holds up the report.
  const gifts = await runGiftMaintenance().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
  // Insiders+ charges, gifts and refunds from Stripe (the last 45 days), so
  // yesterday's memberships are in the email. Never holds up the report
  // either: syncMemberPayments doesn't throw, and a failed read just leaves
  // the email with what was read before.
  const payments = await syncMemberPayments({ mode: "daily", force: true }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "failed" }));
  const result = await sendDailyReport(date, origin);
  return NextResponse.json({ date, gifts, payments, ...result });
}
