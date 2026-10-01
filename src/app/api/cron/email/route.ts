import { NextResponse, type NextRequest } from "next/server";
import { runEmailCron } from "@/lib/email/dispatch";

// Vercel calls this on a schedule (vercel.json): every 15 minutes on the
// Pro plan, or once a morning on Hobby. Each run settles stuck sends, does
// the daily jobs once a day (engagement, the Monday lineup draft, today's
// automated emails), and hands everything due to Resend, with scheduled_at
// for anything that should arrive later today (lib/email/dispatch.ts).
//
// With CRON_SECRET set in Vercel, only Vercel's own call gets through.
// Nothing goes to a list unless EMAIL_SENDING_ENABLED is "true"; while it
// isn't (or a guardrail has paused sending), each run calls back email
// already handed to Resend for later.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  // Stop starting new batches at 4 minutes, well inside the 5-minute limit.
  const deadline = Date.now() + 240_000;
  try {
    const summary = await runEmailCron(deadline);
    return NextResponse.json({
      blocked: summary.blocked,
      recall: summary.recall ?? null,
      cancelsRetried: summary.cancelsRetried ?? 0,
      daily: summary.daily,
      queued: summary.queued,
      runs: summary.runs.map((r) => ({ id: r.id, ran: r.ran, submitted: r.submitted, cancelled: r.cancelled, status: r.status, note: r.note })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
