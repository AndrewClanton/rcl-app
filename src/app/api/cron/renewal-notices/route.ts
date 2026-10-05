import { NextResponse, type NextRequest } from "next/server";
import { runRenewalNotices } from "@/lib/renewal-notice";

// Vercel calls this every morning (vercel.json): a week before a yearly
// Insiders+ renews, the member gets a billing notice with the date, the
// amount and the card (lib/renewal-notice.ts). Each renewal is noticed
// once, however often this runs.
//
// With CRON_SECRET set in Vercel, only Vercel's own call gets through.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  try {
    // Stops starting new notices at 45 seconds, inside the 60-second limit.
    return NextResponse.json(await runRenewalNotices({ deadline: Date.now() + 45_000 }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
