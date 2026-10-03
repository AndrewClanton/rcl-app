import Link from "next/link";
import { joinNames } from "@/lib/email/senders";
import { RecallWaiting, ResumeSending } from "../OverviewControls";
import type { SendingState } from "./data";

// Whether email can go to members right now, in one calm sentence, and
// (when it's stopped or off) the notices with what to do: call back
// what's waiting at Resend, and resume once someone who sends has checked.
// Every word of the old notices is kept; only the look changed.

export function StatusLine({ s, automations = 0, autoWaves = false, settingsLink = true }: { s: SendingState; automations?: number; autoWaves?: boolean; settingsLink?: boolean }) {
  const stopped = !!s.pause;
  const on = s.gate.ok && !stopped;
  const dot = on ? "bg-[#1f8a4c] shadow-[0_0_0_5px_var(--success-bg)]" : stopped ? "bg-[var(--accent-hover)] shadow-[0_0_0_5px_var(--accent-soft)]" : "bg-[var(--warn-text)] shadow-[0_0_0_5px_var(--warn-bg)]";
  return (
    <section aria-label="Sending status" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex min-w-0 flex-1 basis-80 items-center gap-3.5">
        <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${dot}`} />
        <p className="min-w-0">
          {on ? (
            <>
              <strong>Sending is on.</strong> {automations > 0 || autoWaves ? "An email" : "Nothing goes out by itself: an email"} goes to members only when someone who
              sends presses Send or schedules it, a few people at a time.
              {autoWaves ? " Later waves of a ready-made email then go each morning." : ""}
              {automations > 0 ? ` ${automations} ${automations === 1 ? "automation is" : "automations are"} on, and send by themselves.` : ""}
            </>
          ) : stopped ? (
            <>
              <strong>Sending is stopped.</strong> Nothing goes to members until someone who sends has checked and resumed it.
            </>
          ) : (
            <>
              <strong>Sending is off.</strong> Nothing goes to members until it&apos;s on again. Receipts and password resets still go.
            </>
          )}
        </p>
      </div>
      {settingsLink && (
        <Link href="/admin/email/settings#sending" className="inline-flex min-h-11 items-center text-sm text-[var(--muted)] underline-offset-2 hover:text-[var(--foreground)] hover:underline">
          {on ? "Owners switch it off in Settings" : "Sending on/off is in Settings"}
        </Link>
      )}
    </section>
  );
}

// The stopped and off notices (with their buttons), and the emails that
// paused and wait for someone. `sender`: may this person resume, and who can.
export function SendingNotices({ s, sender }: { s: SendingState; sender: { ok: boolean; names: string[] } }) {
  return (
    <>
      {s.pause && (
        <div role="alert" className="space-y-2 rounded-2xl border-2 border-[var(--accent-hover)] bg-[var(--surface)] p-4 text-sm">
          <p>
            <strong>{s.pause.by === "Stopped" ? "Sending is stopped." : "Sending was paused automatically."}</strong> {s.pause.reason.replace(/[.!?]?\s*$/, ".")} Nothing goes to a
            list until someone who sends email has looked and resumed it. Check the latest emails below and Google Postmaster Tools first.
          </p>
          <p>
            {s.waitingAtResend > 0
              ? `${s.waitingAtResend.toLocaleString()} ${s.waitingAtResend === 1 ? "email is" : "emails are"} still waiting at Resend to go out later${s.recallRunning ? ", and being called back right now (reload to see the count go down)" : ""}.`
              : "Nothing is waiting at Resend to go out later."}
          </p>
          {s.waitingAtResend > 0 && <RecallWaiting waiting={s.waitingAtResend} running={s.recallRunning} />}
          {sender.ok ? (
            <ResumeSending />
          ) : (
            <p className="text-xs">{sender.names.length ? joinNames(sender.names) : "Whoever sends email"} can resume sending here once they&apos;ve checked.</p>
          )}
        </div>
      )}
      {!s.gate.ok && (
        <div className="notice notice-warn space-y-2 rounded-2xl text-sm">
          <p>
            Not sending to lists right now: {s.gate.reason}
            {s.waitingAtResend > 0 && !s.pause
              ? ` ${s.waitingAtResend.toLocaleString()} handed to Resend earlier ${s.waitingAtResend === 1 ? "is" : "are"} still waiting to go out${s.recallRunning ? ", and being called back right now (reload to see the count go down)" : "; they're called back on the next email run, or now with the button below"}.`
              : ""}{" "}
            Receipts, password resets and test copies to your own inbox still go.
          </p>
          {s.waitingAtResend > 0 && !s.pause && <RecallWaiting waiting={s.waitingAtResend} running={s.recallRunning} />}
        </div>
      )}
      {s.pausedEmails.length > 0 && (
        <div className="notice notice-warn rounded-2xl text-sm">
          <p className="font-semibold">Paused, waiting for someone to decide:</p>
          <ul className="mt-1 list-disc pl-5">
            {s.pausedEmails.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/email/${c.id}`} className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline sm:min-h-0">
                  {c.name}
                </Link>
                {c.error ? <span className="text-[var(--warn-text)]"> · {c.error.length > 160 ? `${c.error.slice(0, 157)}…` : c.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
