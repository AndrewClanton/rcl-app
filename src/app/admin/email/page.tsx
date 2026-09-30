import Link from "next/link";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getOverview, type CampaignSummary } from "@/lib/email/reports";
import { CONSENT_LABEL, KIND_LABEL, type ConsentSource } from "@/lib/email/types";
import { whenLabel } from "@/lib/email/format";
import { NewEmailButtons, ResumeSending } from "./OverviewControls";

export const dynamic = "force-dynamic";

// Back office -> Email: how the list is doing, what's next, and how the
// last emails did. Managers and up; sending rights are checked by each
// action (admins and owners).

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
      <td className="py-2 pr-3">
        <Link href={`/admin/email/${c.id}`} className="font-semibold hover:underline">
          {c.name}
        </Link>
        <div className="text-xs text-[var(--muted)]">
          {KIND_LABEL[c.kind]} · {STATUS[c.status] ?? c.status}
          {c.sent_at ? ` ${whenLabel(c.sent_at)}` : c.scheduled_for ? ` for ${whenLabel(c.scheduled_for)}` : ""}
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{sent?.recipients ?? c.recipients ?? 0}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{delivered}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{pct(sent?.clickers ?? 0, delivered)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{pct(sent?.unsubscribes ?? 0, delivered)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{pct(sent?.complaints ?? 0, delivered)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {sent?.came_in ?? 0}
        <span className="block text-xs text-[var(--muted)]">{s.windowDays} days</span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{sent?.tickets ?? 0}</td>
      <td className="py-2 text-right tabular-nums">{money((sent?.ticket_revenue ?? 0) + (sent?.order_total ?? 0))}</td>
    </tr>
  );
}

export default async function EmailPage() {
  const staff = await requireManager();
  const admin = hasAdminAccess(staff.role);
  const o = await getOverview();
  const r = o.rates30;
  const complaintRate = r.delivered ? r.complaints / r.delivered : 0;
  const bounceRate = r.delivered ? r.hardBounces / r.delivered : 0;
  const light = !o.sender.ready || complaintRate > 0.003 || bounceRate > 0.05 ? "danger" : complaintRate > 0.001 || bounceRate > 0.02 ? "warn" : "ok";

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        title="Email"
        purpose="The weekly lineup, event emails, automations and how they're doing. Every email goes only to members who want it, at most two a week."
        actions={
          <>
            <Link href="/admin/email/automations" className="btn-secondary !px-4 !py-2 text-sm">
              Automations
            </Link>
            {admin && (
              <Link href="/admin/email/suppressions" className="btn-secondary !px-4 !py-2 text-sm">
                Never-mail list
              </Link>
            )}
          </>
        }
      />

      {o.paused_by_guardrail && (
        <div className="notice notice-warn space-y-2 text-sm">
          <p>
            <strong>Sending is paused.</strong> {o.paused_by_guardrail.reason} Nothing goes to a list until an admin has looked and resumed it. Check the latest
            emails below and Google Postmaster Tools first.
          </p>
          {admin && <ResumeSending />}
        </div>
      )}
      {!o.gate.ok && <p className="notice notice-warn text-sm">Not sending to lists yet: {o.gate.reason}</p>}

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)]">Mailable now</div>
          <div className="text-2xl font-semibold tabular-nums">{o.mailable.toLocaleString()}</div>
          <div className="text-xs text-[var(--muted)]">
            +{o.joined30} joined, −{o.left30} unsubscribed in 30 days
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)]">Resting</div>
          <div className="text-sm">
            {o.paused} paused · {o.dormant} gone quiet · {o.suppressed} never-mail
          </div>
          <div className="text-xs text-[var(--muted)]">{o.onList.toLocaleString()} have email switched on</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)]">Next send</div>
          {o.next ? (
            <>
              <Link href={`/admin/email/${o.next.id}`} className="block text-sm font-semibold hover:underline">
                {o.next.name}
              </Link>
              <div className="text-xs text-[var(--muted)]">{o.next.scheduled_for ? whenLabel(o.next.scheduled_for) : "As soon as possible"} · approved</div>
            </>
          ) : (
            <div className="text-sm text-[var(--muted)]">Nothing scheduled.</div>
          )}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)]">Deliverability</div>
          <div className={`text-sm font-semibold ${light === "danger" ? "text-[var(--danger-text)]" : light === "warn" ? "text-[var(--warn-text)]" : "text-[var(--success-text)]"}`}>
            {light === "ok" ? "Healthy" : light === "warn" ? "Keep an eye on it" : o.sender.ready ? "Needs a look" : "Not set up"}
          </div>
          <div className="text-xs text-[var(--muted)]">
            30 days: {pct(r.complaints, r.delivered)} complaints (Yahoo, Microsoft, AOL), {pct(r.hardBounces, r.delivered)} hard bounces.{" "}
            {o.lastWebhookAt ? `Last word from Resend ${whenLabel(o.lastWebhookAt)}.` : "No word from Resend yet."}{" "}
            <a href="https://postmaster.google.com/" target="_blank" rel="noreferrer" className="underline">
              Gmail: Postmaster Tools
            </a>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 font-semibold">New email</h2>
        <NewEmailButtons />
      </section>

      {o.drafts.length > 0 && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="mb-2 font-semibold">Drafts</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {o.drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <Link href={`/admin/email/${d.id}`} className="font-semibold hover:underline">
                  {d.name}
                  {d.content?.autopilot ? <span className="ml-2 rounded-full bg-[var(--gold)] px-2 py-0.5 text-[10px] uppercase">Monday draft · approve by Tue 10:00</span> : null}
                </Link>
                <span className="text-xs text-[var(--muted)]">
                  {KIND_LABEL[d.kind]} · started {whenLabel(d.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-1 font-semibold">Last emails</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Clicks are the number to watch (opens are rough: Apple Mail opens everything). &ldquo;Came in&rdquo; is people who checked in, had a ticket or ordered within the
          window after the email: it came after, not necessarily because of.
        </p>
        {o.recent.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-right text-xs text-[var(--muted)]">
                  <th className="py-1 pr-3 text-left font-normal">Email</th>
                  <th className="py-1 pr-3 font-normal">Sent</th>
                  <th className="py-1 pr-3 font-normal">Delivered</th>
                  <th className="py-1 pr-3 font-normal">Clicked</th>
                  <th className="py-1 pr-3 font-normal">Unsubscribed</th>
                  <th className="py-1 pr-3 font-normal">Complaints</th>
                  <th className="py-1 pr-3 font-normal">Came in</th>
                  <th className="py-1 pr-3 font-normal">Tickets</th>
                  <th className="py-1 font-normal">Spent after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {o.recent.map((s) => (
                  <CampaignRowView key={s.campaign.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 font-semibold">Who&apos;s on the list, by where their yes came from</h2>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {(Object.entries(o.byConsent) as [ConsentSource, number][])
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <li key={k} className="flex justify-between gap-3">
                <span>{CONSENT_LABEL[k]}</span>
                <span className="tabular-nums">{n.toLocaleString()}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
