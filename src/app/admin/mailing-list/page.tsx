import { requireManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { getLineup } from "@/lib/data/lineup";
import { countSubscribers, firstNameOf, mailingListConfigured } from "@/lib/mailing-list";
import { senderStatus } from "@/lib/lineup-send";
import type { LineupData } from "@/lib/email/lineup-email";
import MailingListPanel, { type SendRow, type SyncRow } from "./MailingListPanel";

export const dynamic = "force-dynamic";
// A send first brings the whole list up to date (up to ~40 seconds on a big
// change), then hands the email to Resend.
export const maxDuration = 60;

// The members' mailing list: who's on it, and this week's lineup email.
export default async function MailingListPage() {
  const staff = await requireManager();
  const today = businessDay().date;
  const supabase = createAdminClient();

  const [subscribers, lastSync, sends, lineup] = await Promise.all([
    countSubscribers().catch(() => null),
    supabase
      .from("mailing_list_syncs")
      .select("started_at, finished_at, complete, subscribers, added, removed, opted_out, errors")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => (r.data as SyncRow | null) ?? null),
    supabase
      .from("mailing_sends")
      .select("id, subject, status, range_start, recipients, error, created_at, sent_at, sender:employees!mailing_sends_created_by_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(10)
      .then((r) => (r.data ?? []) as unknown as SendRow[]),
    getLineup(today, 7).catch((): LineupData => ({ rangeStart: today, rangeDays: 7, films: [], happenings: [] })),
  ]);

  const sender = senderStatus();
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Mailing list</h1>
      <p className="mb-4 max-w-2xl text-sm text-[var(--muted)]">
        Members who asked for the weekly email, kept in step with Resend automatically. Build this week&apos;s lineup from the showtimes, send yourself a test,
        then send it to the list. It&apos;s members only, so the film archive titles can go in it; it never appears anywhere on the website.
      </p>
      <MailingListPanel
        // A fresh key each time the page loads: a double click on Send reuses it, so the list only gets one copy.
        sendKey={crypto.randomUUID()}
        today={today}
        initialLineup={lineup}
        subscribers={subscribers}
        lastSync={lastSync}
        sends={sends}
        connected={mailingListConfigured()}
        sender={sender}
        webhookReady={!!process.env.RESEND_WEBHOOK_SECRET}
        myEmail={staff.email}
        myFirstName={firstNameOf(staff.name)}
      />
    </div>
  );
}
