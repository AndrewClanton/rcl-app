import Link from "next/link";
import { businessDay, shiftDate } from "@/lib/ops/time";
import { buildDailyDigest } from "@/lib/data/daily-digest";
import { dailyDigestHtml, dailyDigestSubject } from "@/lib/email/daily-digest-email";
import { emailConfigured } from "@/lib/email/send";
import { reportRecipients } from "@/lib/daily-report";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import SendNow from "./SendNow";

export const dynamic = "force-dynamic";

// Preview of the end-of-day email the admins get each morning, for any day.
export default async function DailyEmailPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: param } = await searchParams;
  const yesterday = shiftDate(businessDay().date, -1);
  const date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) && param <= businessDay().date ? param : yesterday;
  const origin = await siteOrigin();

  const [digest, recipients, log] = await Promise.all([
    buildDailyDigest(date),
    reportRecipients(),
    createAdminClient().from("daily_report_log").select("sent_at, recipients, errors").eq("business_date", date).maybeSingle(),
  ]);
  const html = dailyDigestHtml(digest, `${origin}/admin/reports?date=${date}`);
  const configured = emailConfigured();
  const sent = log.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/reports" className="text-sm text-[var(--muted)] hover:underline">
          ← Reports
        </Link>
        <h1 className="mr-2 text-lg font-semibold">Daily email</h1>
        <Link href={`/admin/reports/daily?date=${shiftDate(date, -1)}`} className="chip !px-2.5 !py-1 !text-sm" aria-label="Previous day">
          ◀
        </Link>
        <span className="text-sm font-semibold">{digest.label}</span>
        {date < businessDay().date && (
          <Link href={`/admin/reports/daily?date=${shiftDate(date, 1)}`} className="chip !px-2.5 !py-1 !text-sm" aria-label="Next day">
            ▶
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <iframe title="Daily email preview" srcDoc={html} sandbox="" className="h-[1500px] w-full rounded-lg border border-[var(--border)] bg-white" />
        <aside className="space-y-4 text-sm">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-1 font-semibold">Subject</h2>
            <p className="text-[var(--muted)]">{dailyDigestSubject(digest)}</p>
          </section>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-1 font-semibold">Goes to</h2>
            <p className="text-[var(--muted)]">{recipients.length ? recipients.join(", ") : "No admin has a login email."}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">Every active owner and admin, each morning after the day closes (about 5:15 AM, 4:15 AM in winter).</p>
          </section>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="mb-1 font-semibold">This day</h2>
            <p className="text-[var(--muted)]">
              {sent ? `Sent ${new Date(sent.sent_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })} to ${sent.recipients.join(", ") || "nobody"}.` : "Not sent yet."}
            </p>
            {sent?.errors && <p className="mt-1 text-xs text-[var(--danger-text)]">{sent.errors}</p>}
            <div className="mt-3">
              <SendNow date={date} disabled={!configured} />
            </div>
            {!configured && <p className="mt-2 text-xs text-[var(--danger-text)]">Email isn&apos;t connected yet: RESEND_API_KEY needs to be added in Vercel.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
