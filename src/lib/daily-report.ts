import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDailyDigest } from "@/lib/data/daily-digest";
import { dailyDigestHtml, dailyDigestSubject } from "@/lib/email/daily-digest-email";
import { sendEmail } from "@/lib/email/send";

// Who gets the end-of-day email: every active owner and admin with a login
// email. REPORT_TO (comma-separated) overrides that, e.g. while the sending
// domain isn't verified yet.
export async function reportRecipients(): Promise<string[]> {
  const override = (process.env.REPORT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (override.length) return override;
  const supabase = createAdminClient();
  const { data } = await supabase.from("employees").select("auth_user_id").eq("active", true).in("role", ["owner", "admin"]).not("auth_user_id", "is", null);
  const emails = await Promise.all(
    (data ?? []).map((e) =>
      supabase.auth.admin
        .getUserById(e.auth_user_id as string)
        .then((r) => r.data.user?.email ?? null)
        .catch(() => null),
    ),
  );
  return [...new Set(emails.filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
}

export interface SendResult {
  skipped?: string;
  sent: string[];
  failed: { to: string; error: string }[];
}

// Sends one business day's report to the admins. A day goes out once:
// the log row is claimed first, so a repeated trigger finds it taken.
// `force` (the "Send now" button) sends again regardless.
export async function sendDailyReport(date: string, siteUrl: string, opts: { force?: boolean } = {}): Promise<SendResult> {
  const supabase = createAdminClient();
  if (!opts.force) {
    const { error } = await supabase.from("daily_report_log").insert({ business_date: date });
    if (error) return { skipped: "already sent for that day", sent: [], failed: [] };
  }

  const recipients = await reportRecipients();
  const digest = await buildDailyDigest(date);
  const html = dailyDigestHtml(digest, `${siteUrl}/admin/reports?date=${date}`);
  const subject = dailyDigestSubject(digest);

  const sent: string[] = [];
  const failed: { to: string; error: string }[] = [];
  for (const to of recipients) {
    const r = await sendEmail(to, subject, html);
    if (r.ok) sent.push(to);
    else failed.push({ to, error: r.error });
  }

  if (!opts.force && sent.length === 0) {
    // Nothing went out: free the day so the next try can send it.
    await supabase.from("daily_report_log").delete().eq("business_date", date);
  } else {
    await supabase
      .from("daily_report_log")
      .upsert({ business_date: date, sent_at: new Date().toISOString(), recipients: sent, errors: failed.length ? failed.map((f) => `${f.to}: ${f.error}`).join("; ") : null });
  }
  return { sent, failed };
}
