"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STARTERS } from "@/lib/email/templates";
import { createCampaign, resumeAllSending } from "./actions";

// The Email page's buttons: start a new email from one of the starters,
// and (admins) resume sending after a guardrail.

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
