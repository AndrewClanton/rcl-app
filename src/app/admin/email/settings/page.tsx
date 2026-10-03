import { hasAdminAccess, isOwner, requireManager } from "@/lib/auth";
import { goLiveChecklist } from "@/lib/email/go-live";
import { holdsWork } from "@/lib/email/campaign-send";
import { firstWaveSize, getSendPlan, getWaveMode, listUsage, perDay, perMonth } from "@/lib/email/send-plan";
import { senderCheck, senderRows } from "@/lib/email/senders";
import EmailHeader from "../_studio/EmailHeader";
import { SendingNotices, StatusLine } from "../_studio/Sending";
import { sendingState } from "../_studio/data";
import GoLive from "../GoLive";
import Senders from "../Senders";
import { StopSending } from "../OverviewControls";
import PlanEditors from "./PlanEditors";

export const dynamic = "force-dynamic";
// "Stop all sending", "Call back", "Resume sending" and turning sending off
// call back email inside the action (up to 4 minutes each).
export const maxDuration = 300;

// Back office -> Email -> Settings: the go-live checklist with the owners'
// Sending switch, who sends email to members (owners pick), how waves go
// and our email plan (admins change them), and Emergency stop (any
// manager). Each action checks who may use it, whatever this page shows.

const n = (x: number) => x.toLocaleString("en-US");

export default async function EmailSettingsPage() {
  const staff = await requireManager();
  const admin = hasAdminAccess(staff.role);
  const owner = isOwner(staff.role);
  const now = new Date();
  const [goLive, rows, sender, state, plan, usage, mode, holds] = await Promise.all([
    goLiveChecklist(),
    senderRows().catch(() => null),
    senderCheck(staff).catch(() => ({ ok: false, names: [] as string[], why: null })),
    sendingState(),
    getSendPlan(),
    listUsage(now).catch(() => null),
    getWaveMode(),
    holdsWork().catch(() => true),
  ]);
  const daily = perDay(plan);
  const first = firstWaveSize(plan);

  return (
    <div className="space-y-7">
      <EmailHeader tab="settings" isAdmin={admin} />
      <div className="space-y-3">
        <StatusLine s={state} settingsLink={false} />
        <SendingNotices s={state} sender={sender} />
      </div>

      <GoLive data={goLive} isOwner={owner} />
      <Senders rows={rows} canEdit={owner} />

      <section aria-labelledby="waves-h" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <h2 id="waves-h" className="font-display text-xl">
          Waves and our email plan
        </h2>
        <p>
          A ready-made email goes out in waves, the members most used to hearing from us first:{" "}
          {first < daily ? `the first wave to just ${n(first)}, then ${n(daily)} at a time` : `${n(daily)} at a time`}.{" "}
          {mode === "auto" ? (
            <>
              After the first, a wave goes <strong>by itself each morning</strong> (Monday to Saturday).
            </>
          ) : (
            <>
              After the first, each wave goes <strong>only when someone presses Send the next wave</strong>; nothing goes out by itself.
            </>
          )}{" "}
          Never more than {n(daily)} a day in all. Resend (our email service) is set to {n(plan.daily)} a day and {n(plan.monthly)} a month; {n(plan.reserve)} a day are
          kept for receipts, tickets and the daily report.
        </p>
        {usage && (
          <p className="text-[var(--muted)]">
            Today: {n(usage.today)} of {n(daily)} used. This month: {n(usage.month)} of {n(perMonth(plan))}. Emails called back with Undo still count, in case Resend counts
            them.
          </p>
        )}
        {!holds && admin && (
          <p className="text-[var(--warn-text)]">
            Resend sent at once (or refused) email it was asked to hold for later, so nothing is handed over before it&apos;s due and there&apos;s no Undo. Once that&apos;s
            sorted with Resend, a developer clears the &ldquo;resend_scheduling&rdquo; email setting to try again.
          </p>
        )}
        {admin ? (
          <div className="border-t border-[var(--border)] pt-3">
            <PlanEditors plan={{ daily: plan.daily, monthly: plan.monthly, reserve: plan.reserve, perDay: daily, auto: mode === "auto" }} />
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">An admin can change these.</p>
        )}
      </section>

      <section aria-labelledby="stop-h" id="stop" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <h2 id="stop-h" className="font-display text-xl">
          Emergency stop
          {state.waitingAtResend > 0 ? <span className="font-sans text-sm font-normal text-[var(--muted)]"> · {n(state.waitingAtResend)} waiting at Resend for later</span> : null}
        </h2>
        <p className="text-[var(--muted)]">
          Pauses every email to a list and calls back everything our email service (Resend) is holding to send later (a big list takes a few minutes; it carries on until
          none is left). Any manager can press it, and it can be pressed again. Only someone who sends email can resume afterwards.
        </p>
        <StopSending />
      </section>
    </div>
  );
}
