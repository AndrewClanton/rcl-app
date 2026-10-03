import Link from "next/link";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import { getOverview, type CampaignSummary } from "@/lib/email/reports";
import { CONSENT_LABEL, KIND_LABEL, type ConsentSource } from "@/lib/email/types";
import { whenLabel } from "@/lib/email/format";
import { holdsWork } from "@/lib/email/campaign-send";
import { picturesReady } from "@/lib/email/designs/ready";
import { firstWaveSize, getSendPlan, getWaveMode, listUsage, perDay, perMonth } from "@/lib/email/send-plan";
import { joinNames, senderCheck } from "@/lib/email/senders";
import EmailHeader from "./_studio/EmailHeader";
import { SendingNotices, StatusLine } from "./_studio/Sending";
import { CardGrid, UpNextPanel } from "./_studio/Cards";
import SafetyNet from "./_studio/SafetyNet";
import { Progress } from "./_studio/ui";
import { automationsOn, campaignCard, designCard, designStates, upNext, writtenCampaigns, type CardItem } from "./_studio/data";
import { testLog } from "./_studio/tests-log";

export const dynamic = "force-dynamic";
// "Stop all sending", "Call back" and "Resume sending" call back or hand
// over email inside the action (up to 4 minutes each).
export const maxDuration = 300;

// Back office -> Email -> Overview (Royale Email Studio): whether sending
// is on, the one email most worth a look (Up next), the latest emails as
// cards, how the list is doing, what each email brought in, and the
// safety net with Emergency stop. Managers and up; every action checks its
// own rights (sending is for the people picked, lib/email/senders.ts).

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(n / d < 0.01 && n > 0 ? 2 : 1)}%` : "—");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STATUS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  paused: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
};

function CampaignRowView({ s }: { s: CampaignSummary }) {
  const c = s.campaign;
  const sent = s.sent;
  const delivered = sent?.delivered ?? 0;
  return (
    <tr className="align-top">
      <td className="px-4 py-3 text-left">
        <Link href={`/admin/email/${c.id}`} className="font-bold hover:underline">
          {c.name}
        </Link>
        <div className="text-xs text-[var(--muted)]">
          {KIND_LABEL[c.kind]} · {STATUS[c.status] ?? c.status}
          {c.sent_at ? ` ${whenLabel(c.sent_at)}` : c.scheduled_for ? ` for ${whenLabel(c.scheduled_for)}` : ""}
        </div>
      </td>
      <td className="px-4 py-3">{sent?.recipients ?? c.recipients ?? 0}</td>
      <td className="px-4 py-3">{delivered}</td>
      <td className="px-4 py-3">{pct(sent?.clickers ?? 0, delivered)}</td>
      <td className="px-4 py-3">{pct(sent?.unsubscribes ?? 0, delivered)}</td>
      <td className="px-4 py-3">{pct(sent?.complaints ?? 0, delivered)}</td>
      <td className="px-4 py-3">
        {sent?.came_in ?? 0}
        <span className="block text-xs text-[var(--muted)]">{s.windowDays} days</span>
      </td>
      <td className="px-4 py-3">{sent?.tickets ?? 0}</td>
      <td className="px-4 py-3">{money((sent?.ticket_revenue ?? 0) + (sent?.order_total ?? 0))}</td>
    </tr>
  );
}

export default async function EmailPage() {
  const staff = await requireManager();
  const admin = hasAdminAccess(staff.role);
  const now = new Date();
  const [o, sender, plan, mode, tests, pictures, holds, automations, written] = await Promise.all([
    getOverview(),
    senderCheck(staff).catch(() => ({ ok: false, names: [] as string[], why: null })),
    getSendPlan(),
    getWaveMode(),
    testLog(),
    picturesReady(),
    holdsWork().catch(() => true),
    automationsOn().catch(() => 0),
    writtenCampaigns(40).catch(() => []),
  ]);
  const first = firstWaveSize(plan);
  const daily = perDay(plan);
  const auto = mode === "auto";
  const [designs, usage] = await Promise.all([designStates({ now, firstWave: first, tests, me: staff.employeeId }), listUsage(now).catch(() => null)]);
  const next = await upNext({ designs, campaigns: written, drafts: o.drafts, firstWave: first, perDay: daily, picturesReady: pictures, auto, tests, me: staff.employeeId, now });

  const state = { gate: o.gate, pause: o.paused_by_guardrail, waitingAtResend: o.waitingAtResend, recallRunning: o.recallRunning, pausedEmails: o.pausedEmails };
  const summaries = new Map(o.recent.map((s) => [s.campaign.id, s]));
  const card = (c: (typeof written)[number]) => campaignCard(c, summaries.get(c.id) ?? null);
  const live = (s: string) => s === "scheduled" || s === "sending" || s === "paused";
  // Going or paused first, then what's ready, drafts, and the latest sent.
  const cards: CardItem[] = [
    ...designs.filter((d) => d.status === "going" || d.status === "paused").map((d) => designCard(d, { auto, now })),
    ...written.filter((c) => live(c.status)).map(card),
    ...designs.filter((d) => d.status === "new" || d.status === "failed").map((d) => designCard(d, { auto, now })),
    ...written.filter((c) => c.status === "draft").map(card),
    ...designs.filter((d) => d.status === "sent").map((d) => designCard(d, { auto, now })),
    ...written.filter((c) => c.status === "sent").map(card),
  ].slice(0, 6);

  const r = o.rates30;
  const complaintRate = r.delivered ? r.complaints / r.delivered : 0;
  const bounceRate = r.delivered ? r.hardBounces / r.delivered : 0;
  const light = !o.sender.ready || complaintRate > 0.003 || bounceRate > 0.05 ? "danger" : complaintRate > 0.001 || bounceRate > 0.02 ? "warn" : "ok";
  const monthPlan = perMonth(plan);
  // "Came in after an email": the emails that went out in the last 30
  // days, each one's people who came in within its window (7 days for most).
  // Someone who got two of them counts twice: it's a sum over emails.
  const since = now.getTime() - 30 * 86_400_000;
  const lately = o.recent.filter((s) => Date.parse(s.campaign.sent_at ?? s.campaign.updated_at) >= since);
  const cameIn = lately.reduce((a, s) => a + (s.sent?.came_in ?? 0), 0);
  const spent = lately.reduce((a, s) => a + (s.sent?.ticket_revenue ?? 0) + (s.sent?.order_total ?? 0), 0);

  return (
    <div className="space-y-7">
      <EmailHeader tab="overview" isAdmin={admin} />

      <div className="space-y-3">
        <StatusLine s={state} automations={automations} autoWaves={auto} />
        <SendingNotices s={state} sender={sender} />
        {o.next && (
          <p className="px-1 text-sm text-[var(--muted)]">
            Next to go out:{" "}
            <Link href={`/admin/email/${o.next.id}`} className="font-semibold text-[var(--foreground)] underline-offset-2 hover:underline">
              {o.next.name}
            </Link>
            , {o.next.scheduled_for ? whenLabel(o.next.scheduled_for) : "as soon as possible"} · approved
          </p>
        )}
      </div>

      <UpNextPanel next={next} senders={!sender.ok && sender.names.length ? `Only ${joinNames(sender.names)} send email to members.` : null} />

      <section aria-labelledby="camp-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="camp-h" className="font-display text-2xl">
            Campaigns
          </h2>
          <Link href="/admin/email/campaigns" className="inline-flex min-h-11 items-center font-bold text-[var(--accent-hover)] hover:underline">
            See all
          </Link>
        </div>
        {cards.length ? <CardGrid cards={cards} /> : <p className="text-sm text-[var(--muted)]">No emails yet.</p>}
      </section>

      <section aria-labelledby="health-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="health-h" className="font-display text-2xl">
            How the list is doing
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="es-tile">
            <span className="text-sm text-[var(--muted)]">Want our email</span>
            <span className="font-display text-[26px] leading-tight tabular-nums sm:text-[34px]">{o.mailable.toLocaleString()}</span>
            <span className="text-sm">
              <span className="font-semibold text-[var(--success-text)]">+{o.joined30} joined</span>
              <span className="text-[var(--muted)]">, −{o.left30} unsubscribed in 30 days</span>
            </span>
          </div>
          <div className="es-tile">
            <span className="text-sm text-[var(--muted)]">Reaching inboxes</span>
            <span
              className={`font-display text-[22px] leading-tight sm:text-[30px] ${light === "danger" ? "text-[var(--accent-hover)]" : light === "warn" ? "text-[var(--warn-text)]" : "text-[var(--success-text)]"}`}
            >
              {light === "ok" ? "Healthy" : light === "warn" ? "Keep an eye on it" : o.sender.ready ? "Needs a look" : "Not set up"}
            </span>
            <span className="text-sm text-[var(--muted)]">
              {r.complaints === 0 ? "Nobody marked us as spam" : `${pct(r.complaints, r.delivered)} marked us as spam`} (Yahoo, Microsoft, AOL), {pct(r.hardBounces, r.delivered)} hard
              bounces, 30 days.
            </span>
          </div>
          <div className="es-tile gap-2">
            <span className="text-sm text-[var(--muted)]">Emails used this month</span>
            {usage ? (
              <>
                <span className="font-display text-[26px] leading-tight tabular-nums sm:text-[34px]">
                  {usage.month.toLocaleString()} <span className="font-sans text-base font-normal text-[var(--muted)]">of {monthPlan.toLocaleString()}</span>
                </span>
                <Progress done={usage.month} total={monthPlan} label={`${usage.month.toLocaleString()} of ${monthPlan.toLocaleString()} list emails this month`} />
                <span className="text-xs text-[var(--muted)]">To lists, of our email plan. The rest is kept for receipts.</span>
              </>
            ) : (
              <span className="text-sm text-[var(--muted)]">Couldn&apos;t count just now.</span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-[var(--foreground)] p-4 text-[var(--background)] sm:p-5">
            <span className="text-sm text-[#d9d2bf]">Came in after an email</span>
            <span className="font-display text-[26px] leading-tight tabular-nums text-[var(--gold)] sm:text-[34px]">{cameIn.toLocaleString()}</span>
            <span className="text-sm text-[#d9d2bf]">and spent {money(spent)}, after the last 30 days&apos; emails</span>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {o.lastWebhookAt ? `Last word from Resend ${whenLabel(o.lastWebhookAt)}.` : "No word from Resend yet."}{" "}
          <a href="https://postmaster.google.com/" target="_blank" rel="noreferrer" className="underline">
            Gmail: Postmaster Tools
          </a>
          . &ldquo;Came in after&rdquo; adds up each email&apos;s people, so someone who got two counts twice.
        </p>
        <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">More about the list</summary>
          <p className="mt-2">
            Resting: {o.paused} paused · {o.dormant} gone quiet · {o.suppressed} never-mail. {o.onList.toLocaleString()} have email switched on.
          </p>
          <h3 className="mb-1 mt-3 font-semibold">Who&apos;s on the list, by where their yes came from</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {(Object.entries(o.byConsent) as [ConsentSource, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <li key={k} className="flex justify-between gap-3">
                  <span>{CONSENT_LABEL[k]}</span>
                  <span className="tabular-nums">{n.toLocaleString()}</span>
                </li>
              ))}
          </ul>
        </details>
      </section>

      <section aria-labelledby="results-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="results-h" className="font-display text-2xl">
            What each email brought in
          </h2>
        </div>
        {o.recent.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]" tabIndex={0} role="region" aria-labelledby="results-h">
            <table className="w-full min-w-[760px] text-right text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Sent</th>
                  <th className="px-4 py-3 font-semibold">Delivered</th>
                  <th className="px-4 py-3 font-semibold">Tapped a link</th>
                  <th className="px-4 py-3 font-semibold">Unsubscribed</th>
                  <th className="px-4 py-3 font-semibold">Complaints</th>
                  <th className="px-4 py-3 font-semibold">Came in after</th>
                  <th className="px-4 py-3 font-semibold">Tickets</th>
                  <th className="px-4 py-3 font-semibold" title="Online tickets plus register orders, without tips or trivia vouchers">
                    Spent after
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {o.recent.map((s) => (
                  <CampaignRowView key={s.campaign.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-[var(--muted)]">
          Taps on links are the number to watch (opens are rough: Apple Mail opens everything). &ldquo;Came in after&rdquo; counts people who checked in, had a ticket or
          ordered within the window after the email: it came after the email, not always because of it.
        </p>
      </section>

      <SafetyNet firstWave={first} undo={holds} waitingAtResend={o.waitingAtResend} />
    </div>
  );
}
