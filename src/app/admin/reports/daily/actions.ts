"use server";

import { assertAdmin } from "@/lib/auth";
import { sendDailyReport } from "@/lib/daily-report";
import { siteOrigin } from "@/lib/site-origin";

// "Send to the admins now" on the daily email preview. Sends even if that
// day already went out.
export async function sendDailyReportNow(date: string): Promise<{ ok: true; sent: string[]; failed: { to: string; error: string }[] } | { ok: false; error: string }> {
  await assertAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a day." };
  try {
    const r = await sendDailyReport(date, await siteOrigin(), { force: true });
    return { ok: true, sent: r.sent, failed: r.failed };
  } catch {
    return { ok: false, error: "Couldn't build or send the report. Try again." };
  }
}
