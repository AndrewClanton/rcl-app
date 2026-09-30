"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import { STARTERS } from "@/lib/email/templates";
import { createCampaign, resumeAllSending, stopAllSending } from "./actions";

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
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}

export function ResumeSending() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input !w-auto min-w-64 flex-1 text-sm" placeholder="What you checked (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        type="button"
        className="btn-primary !px-4 !py-2 text-sm"
        disabled={pending || reason.trim().length < 5}
        onClick={() =>
          start(async () => {
            const r = await resumeAllSending(reason).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }
      >
        Resume sending
      </button>
      {error && <span className="text-sm text-[var(--danger-text)]">{error}</span>}
    </div>
  );
}

// The emergency stop: pauses every list email and calls back what's waiting
// at Resend for later. Resumed with "Resume sending".
export function StopSending() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input !w-auto min-w-64 flex-1 text-sm" placeholder="Why (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn-secondary !px-4 !py-2 text-sm text-[var(--danger-text)]" disabled={pending || reason.trim().length < 5} onClick={() => setConfirm(true)}>
        {pending ? "Stopping…" : "Stop all sending"}
      </button>
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
              if (!r.ok) setMsg({ ok: false, text: r.error });
              else {
                setMsg({
                  ok: true,
                  text: `Stopped. ${r.recalled} called back from Resend${r.failed ? `, ${r.failed} had already gone` : ""}${r.left ? `, ${r.left} still waiting there: press Stop again` : ""}.`,
                });
                router.refresh();
              }
            });
          }}
        />
      )}
    </div>
  );
}
