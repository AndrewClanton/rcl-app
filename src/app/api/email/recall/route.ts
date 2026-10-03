import { after, NextResponse, type NextRequest } from "next/server";
import { RECALL_MAX_HOPS, recallAll, recallReason } from "@/lib/email/campaign-send";

// Carries on calling back email waiting at Resend while sending is stopped
// ("Stop all sending", a guardrail) or switched off. Resend cancels one
// email per request, so a big list takes more than one 5-minute run: each
// run calls back what it can and hands the rest to the next
// (lib/email/campaign-send.ts, recallAll), up to RECALL_MAX_HOPS in a row,
// until nothing is left or sending is back on.
//
// Only our own server calls this, signed with CRON_SECRET; without
// CRON_SECRET it's switched off (the Email page's "Call back" button does
// the same job while an admin keeps the page open). It answers at once and
// works after the answer (after()), so the run that called it isn't held up.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const hop = Math.max(1, Math.min(RECALL_MAX_HOPS, Math.floor(Number(req.nextUrl.searchParams.get("hop"))) || 1));
  const reason = await recallReason();
  if (!reason) return NextResponse.json({ done: true, note: "Sending isn't stopped, so nothing is called back." });
  after(async () => {
    try {
      await recallAll(reason, { deadline: Date.now() + 230_000, hop });
    } catch (e) {
      console.error("email recall:", e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ started: true, hop }, { status: 202 });
}
