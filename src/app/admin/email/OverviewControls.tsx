"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import { STARTERS } from "@/lib/email/templates";
import { createCampaign, recallWaiting, resumeAllSending, stopAllSending } from "./actions";

// The Email page's buttons: start a new email from one of the starters,
// and (admins) stop all sending in an emergency, or resume it after a stop
// or a guardrail.

export function NewEmailButtons() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choices = [{ key: "lineup", label: "Weekly lineup", about: "Tuesday 10:30 AM, Tuesday to Monday. Built from the showtimes." }, ...STARTERS];
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {choices.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={pending}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-left hover:border-[var(--foreground)] disabled:opacity-60"
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await createCampaign(s.key).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
                if (!r.ok) setError(r.error);
                else router.push(`/admin/email/${r.id}`);
              })
            }
          >
            <div className="text-sm font-semibold">{s.label}</div>
            <div className="text-xs text-[var(--muted)]">{s.about}</div>
          </button>
        ))}
      </div>
      {pending && (
        <p className="mt-2 text-sm text-[var(--muted)]" role="status">
          Starting the draft and opening it…
        </p>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}

export function ResumeSending() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input min-h-11 !w-auto min-w-0 flex-1 basis-56 text-sm" placeholder="What you checked (required)" aria-label="What you checked" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        type="button"
        className="btn-send"
        disabled={pending || reason.trim().length < 5}
        onClick={() =>
          start(async () => {
            const r = await resumeAllSending(reason).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            if (!r.ok) setMsg({ ok: false, text: r.error });
            else {
              setMsg({ ok: true, text: r.message });
              router.refresh();
            }
          })
        }
      >
        {pending ? "Resuming…" : "Resume sending"}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</span>}
    </div>
  );
}

// ---------- calling back email waiting at Resend ----------
type Recall = { recalled: number; failed: number; left: number; busy?: boolean; continuing?: boolean };

function recallSummary(recalled: number, failed: number, last: Recall): string {
  const bits = [`${recalled.toLocaleString()} called back from Resend`];
  if (failed) bits.push(`${failed.toLocaleString()} couldn't be (most had already gone)`);
  if (last.busy) bits.push(`a call-back was already running, with ${last.left.toLocaleString()} still waiting (the count on this page goes down as it works)`);
  else if (last.continuing) bits.push(`the other ${last.left.toLocaleString()} are being called back in the background (the count on this page goes down as it works)`);
  else if (last.left) bits.push(`${last.left.toLocaleString()} still waiting there: press "Call back" to carry on`);
  return `${bits.join(", ")}.`;
}

// Resend cancels one email per request, so a big list takes several rounds
// of a few minutes. When the server isn't carrying on by itself, the page
// does, round after round, while it stays open. `refresh` after each round
// keeps the page's own count (still waiting at Resend) up to date.
async function keepCallingBack(first: Recall, say: (text: string) => void, refresh: () => void): Promise<string> {
  let recalled = first.recalled;
  let failed = first.failed;
  let last = first;
  for (let round = 0; round < 30 && last.left > 0 && !last.busy && !last.continuing && last.recalled > 0; round++) {
    say(`Calling back from Resend: ${recalled.toLocaleString()} so far, about ${last.left.toLocaleString()} to go. Keep this page open.`);
    const r = await recallWaiting().catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    if (!r.ok) return `${recalled.toLocaleString()} called back from Resend, then it stopped: ${r.error} Press "Call back" to carry on.`;
    recalled += r.recalled;
    failed += r.failed;
    last = r;
    refresh();
  }
  return recallSummary(recalled, failed, last);
}

// While sending is stopped: the number still waiting at Resend, and a button
// to call them back (it carries on by itself while the page is open).
export function RecallWaiting({ waiting, running }: { waiting: number; running: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary min-h-11 !px-4 !py-2 text-sm"
        disabled={pending || waiting === 0}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await recallWaiting().catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            if (!r.ok) {
              setMsg({ ok: false, text: r.error });
              return;
            }
            router.refresh();
            const text = await keepCallingBack(r, (t) => setMsg({ ok: true, text: t }), () => router.refresh());
            setMsg({ ok: true, text });
            router.refresh();
          })
        }
      >
        {pending ? "Calling back…" : `Call back what's still waiting at Resend (${waiting.toLocaleString()})`}
      </button>
      {running && !pending && <span className="text-sm text-[var(--muted)]">Already being called back in the background.</span>}
      {msg && <span className={`text-sm ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</span>}
    </div>
  );
}

// The emergency stop: pauses every list email and calls back what's waiting
// at Resend for later, all of it (in the background, or from this page while
// it's open). Resumed with "Resume sending".
export function StopSending() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Quiet until it's wanted: the first press only asks why.
  const [armed, setArmed] = useState(false);
  if (!armed && !pending && !msg)
    return (
      <button type="button" className="btn-quiet" aria-expanded={false} onClick={() => setArmed(true)}>
        Emergency stop: pause every email
      </button>
    );
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="stop-why">
        Why you&apos;re stopping all sending
      </label>
      <input id="stop-why" className="input min-h-11 !w-auto min-w-0 flex-1 basis-56 text-sm" placeholder="Why (required)" value={reason} autoFocus={armed && !msg} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn-quiet !border-[var(--accent-hover)]" disabled={pending || reason.trim().length < 5} onClick={() => setConfirm(true)}>
        {pending ? "Stopping…" : "Stop all sending"}
      </button>
      {!pending && !msg && (
        <button type="button" className="btn-secondary min-h-11 !px-4 !py-2 text-sm" onClick={() => setArmed(false)}>
          Cancel
        </button>
      )}
      {msg && <span className={`text-sm ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</span>}
      {confirm && (
        <ConfirmModal
          title="Stop all sending?"
          description="Every email to a list pauses, and email waiting at Resend for later is called back. Email that has already gone can't be taken back."
          confirmLabel="Stop everything"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            start(async () => {
              const r = await stopAllSending(reason).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
              if (!r.ok) {
                setMsg({ ok: false, text: r.error });
                return;
              }
              // Sending is stopped from here on: show the page as it now is
              // (the stopped banner, with the number still waiting at Resend
              // and its own "Call back" button), and keep calling back until
              // nothing's left, unless the server is already carrying on.
              router.refresh();
              const text = await keepCallingBack(r, (t) => setMsg({ ok: true, text: `Stopped. ${t}` }), () => router.refresh());
              setMsg({ ok: true, text: `Stopped. ${text}` });
              router.refresh();
            });
          }}
        />
      )}
    </div>
  );
}
