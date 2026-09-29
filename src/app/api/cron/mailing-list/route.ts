import { NextResponse, type NextRequest } from "next/server";
import { mailingListConfigured, reconcileMailingList } from "@/lib/mailing-list";

// Vercel calls this every night (vercel.json) to bring Resend's copy of the
// mailing list in line with the members table: it picks up opt-ins and
// opt-outs made anywhere (like the register's check-in kiosk), removed
// members, and any unsubscribe whose webhook was missed. With CRON_SECRET
// set in Vercel, only Vercel's own call gets through.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  if (!mailingListConfigured()) return NextResponse.json({ skipped: "RESEND_API_KEY isn't set" });
  const result = await reconcileMailingList("cron", 45_000);
  return NextResponse.json(result);
}
