import type { CampaignDetail } from "@/lib/email/reports";
import { EXCLUSION_LABEL, type CampaignKind, type Exclusion } from "@/lib/email/types";
import { whenLabel } from "@/lib/email/format";
import CampaignActions from "./CampaignActions";

// How one email did: the funnel, "came in after" for the people who got it
// and (when there was one) the random group held back, top links, results
// by where people's yes came from, clicks by day, who it didn't go to and
// why, and the warm-up waves. Counts only; each person's own history is on
// their member page.

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export default function Results({ detail, canSend, campaignId, status, kind }: { detail: CampaignDetail; canSend: boolean; campaignId: string; status: string; kind: CampaignKind }) {
  const f = detail.funnel;
  const s = detail.summary.sent;
  const h = detail.summary.heldOut;
  const rate = (n: number | undefined, d: number | undefined) => (d ? (n ?? 0) / d : 0);
  const showLift = !!h && h.recipients >= 50 && !!s;
  const lift = showLift ? rate(s?.came_in, s?.recipients) - rate(h?.came_in, h?.recipients) : 0;
  const excluded = Object.entries(detail.summary.campaign.excluded ?? {}).filter(([, n]) => (n ?? 0) > 0) as [Exclusion, number][];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">How it did</h2>
        <CampaignActions id={campaignId} status={status} kind={kind} canSend={canSend} waitingAtResend={f.waitingAtResend} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Handed to Resend" value={f.submitted} sub={`${f.waitingAtResend ? `${f.waitingAtResend} held at Resend for later · ` : ""}${f.queued} waiting · ${f.cancelled} stopped · ${f.failed} refused`} />
        <Stat label="Delivered" value={f.delivered} sub={pct(f.delivered, f.submitted)} />
        <Stat label="Opened (rough)" value={f.opened} sub="Apple Mail opens everything" />
        <Stat label="Clicked" value={f.clicked} sub={`${pct(f.clicked, f.delivered)} of delivered`} />
        <Stat label="Unsubscribed" value={f.unsubscribed} sub={pct(f.unsubscribed, f.delivered)} />
        <Stat label="Complaints · bounces" value={`${f.complained} · ${detail.summary.hardBounces}`} sub="complaints: Yahoo/Microsoft/AOL only" />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="font-semibold">Came in after</h3>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Checked in, had a ticket or ordered within {detail.summary.windowDays} days of the email. This says what came after, not what the email caused.
          Money is what was paid: tips and trivia vouchers (prizes, not money in) are left out, and each ticket is counted once.
          {h ? " The held-back group is a random slice that didn't get it: the difference is the honest lift." : ""}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-right text-xs text-[var(--muted)]">
                <th className="py-1 pr-3 text-left font-normal" />
                <th className="py-1 pr-3 font-normal">People</th>
                <th className="py-1 pr-3 font-normal">Came in</th>
                <th className="py-1 pr-3 font-normal">…after a click</th>
                <th className="py-1 pr-3 font-normal">Tickets</th>
                <th className="py-1 pr-3 font-normal">Online tickets $</th>
                <th className="py-1 pr-3 font-normal">Register $ (tickets, bar, kitchen)</th>
                <th className="py-1 pr-3 font-normal">Trivia vouchers (no money in)</th>
                <th className="py-1 font-normal">Now Insiders+</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {[
                ["Got it", s],
                ["Held back", h],
              ].map(([label, o]) =>
                o && typeof o === "object" ? (
                  <tr key={label as string}>
                    <td className="py-1.5 pr-3">{label as string}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{o.recipients}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {o.came_in} <span className="text-xs text-[var(--muted)]">({pct(o.came_in, o.recipients)})</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{o.came_in_after_click}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{o.tickets}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(o.ticket_revenue)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(o.order_total)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(o.voucher_total)}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.now_plus}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
        {showLift && (
          <p className="mt-2 text-sm">
            Lift: <strong>{(lift * 100).toFixed(1)} points</strong> more of the people who got it came in than of the held-back group.
          </p>
        )}
        {h && !showLift && <p className="mt-2 text-xs text-[var(--muted)]">Lift shows once at least 50 people are held back.</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 font-semibold">Top links</h3>
          {detail.topLinks.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No clicks yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {detail.topLinks.map((l) => (
                <li key={l.i} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate" title={l.url}>
                    {l.label}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {l.people} people · {l.clicks}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {detail.suspectClicks > 0 && <p className="mt-2 text-xs text-[var(--muted)]">{detail.suspectClicks} clicks looked like mail scanners and aren&apos;t counted.</p>}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 font-semibold">By where their yes came from</h3>
          {detail.byCohort.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing sent yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--border)]">
                {detail.byCohort.map((c) => (
                  <tr key={c.cohort}>
                    <td className="py-1.5 pr-2">{c.cohort}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{c.sent} sent</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(c.clicked, c.delivered)} clicked</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 font-semibold">Clicks by day</h3>
          {detail.clicksByDay.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No clicks yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detail.clicksByDay.map((d) => {
                const max = Math.max(...detail.clicksByDay.map((x) => x.clicks));
                return (
                  <li key={d.day} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs text-[var(--muted)]">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</span>
                    <span className="h-3 rounded-sm bg-[var(--foreground)]" style={{ width: `${Math.max(4, (d.clicks / max) * 100)}%` }} />
                    <span className="tabular-nums">{d.clicks}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 font-semibold">Not sent to</h3>
          {excluded.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nobody was left out.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {excluded
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <li key={k} className="flex justify-between gap-3 py-1.5">
                    <span>{EXCLUSION_LABEL[k] ?? k}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {detail.waves.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 font-semibold">Warm-up waves</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-[var(--muted)]">
                <th className="py-1 pr-2 text-left font-normal">Wave</th>
                <th className="py-1 pr-2 font-normal">People</th>
                <th className="py-1 pr-2 font-normal">Delivered</th>
                <th className="py-1 pr-2 font-normal">Hard bounces</th>
                <th className="py-1 font-normal">Complaints</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {detail.waves.map((w, i) => (
                <tr key={w.at}>
                  <td className="py-1.5 pr-2">
                    {i + 1}. {whenLabel(w.at)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{w.n}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{w.delivered}</td>
                  <td className={`py-1.5 pr-2 text-right tabular-nums ${w.n && w.hardBounces / w.n > 0.03 ? "text-[var(--danger-text)]" : ""}`}>{pct(w.hardBounces, w.n)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${w.delivered && w.complaints / w.delivered > 0.002 ? "text-[var(--danger-text)]" : ""}`}>{pct(w.complaints, w.delivered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--muted)]">Stop before the next wave if the last one had over 3% hard bounces or over 0.2% complaints.</p>
        </div>
      )}
    </section>
  );
}
