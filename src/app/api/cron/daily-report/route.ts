import { NextResponse, after, type NextRequest } from "next/server";
import { businessDay, shiftDate } from "@/lib/ops/time";
import { sendDailyReport } from "@/lib/daily-report";
import { runGiftMaintenance } from "@/lib/gift-membership";
import { syncMemberPayments, type SyncResult } from "@/lib/membership-payments/sync";
import { sweepSeatCheckouts } from "@/lib/seat-ordering-server";
import { awardEventBadges, refreshDrafts } from "@/lib/badges/events";

// Vercel calls this every morning (vercel.json) to email the admins the
// business day that just ended. With CRON_SECRET set in Vercel, only
// Vercel's own call gets through; either way each day is sent only once.
export const dynamic = "force-dynamic";
// The email waits at most SYNC_WAIT_MS for member payments to be read from
// Stripe; a read still going then finishes after the answer (after()). It
// starts no Stripe call after SYNC_STOP_MS: the sync's Stripe client gives
// a call at most about 21 s (10 s, a short pause, 10 s again), so the read
// is over before this limit ends the function.
export const maxDuration = 60;
const SYNC_WAIT_MS = 20_000;
const SYNC_STOP_MS = 35_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const t0 = Date.now();
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
  // yesterday's memberships are in the email. Never holds up the report for
  // long: after SYNC_WAIT_MS the email goes with what was read before (the
  // Reports sync, the webhook), and the read carries on after the answer.
  const run: Promise<SyncResult | { ok: false; error: string }> = syncMemberPayments({ mode: "daily", force: true, deadline: t0 + SYNC_STOP_MS }).catch((e: unknown) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : "failed",
  }));
  const payments = await Promise.race([run, sleep(Math.max(0, t0 + SYNC_WAIT_MS - Date.now())).then(() => null)]);
  if (!payments) {
    after(async () => {
      const r = await run;
      if (!r.ok) console.warn("daily report: member payments read (after the email) failed:", r.error);
    });
  }
  const result = await sendDailyReport(date, origin);
  // Seat orders paid on a phone that never came back (and no webhook): made
  // into their orders; old unpaid checkouts tidied (paid ones never are).
  // After the answer, so it never holds up the report.
  after(async () => {
    const r = await sweepSeatCheckouts({ recentMs: 3 * 86_400_000, cleanup: true, max: 50 }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
    console.log("daily report: seat checkout sweep", r);
  });
  // Event badges for anyone who came and didn't get theirs at the time
  // (lib/badges/events.ts), and fresh drafts from the next two weeks'
  // calendar for Back office -> Badges to review. After the answer.
  after(async () => {
    const r = await awardEventBadges({ fresh: true }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
    const awarded = "perDef" in r ? Object.values(r.perDef).reduce((n, d) => n + d.awarded, 0) : r;
    const drafts = await refreshDrafts().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
    console.log("daily report: event badges", { awarded, drafts });
  });
  return NextResponse.json({ date, gifts, payments: payments ?? { ok: false, skipped: `still reading Stripe after ${SYNC_WAIT_MS / 1000} s; the email went with what was read before, and the read finishes after this` }, ...result });
}
