"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import type { CampaignKind } from "@/lib/email/types";
import { cancelCampaign, duplicateCampaign, resumeCampaign } from "../actions";

// Buttons on a campaign that's gone (or is going) out: copy it, stop what
// hasn't gone yet (including email handed to Resend for later, even once
// the campaign reads "sent"), or resume one that paused.
export default function CampaignActions({ id, status, kind, canSend, waitingAtResend = 0 }: { id: string; status: string; kind: CampaignKind; canSend: boolean; waitingAtResend?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: (r: unknown) => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn().catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!r.ok) setMsg(r.error);
      else {
        after?.(r);
        router.refresh();
      }
    });

  if (kind === "automation") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary !px-3 !py-1.5 text-sm"
        disabled={pending}
        onClick={() => act(() => duplicateCampaign(id), (r) => router.push(`/admin/email/${(r as { id: string }).id}`))}
      >
        Copy as a new draft
      </button>
      {canSend && status === "paused" && (
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={pending} onClick={() => act(() => resumeCampaign(id))}>
          Resume
        </button>
      )}
      {canSend && (["scheduled", "sending", "paused"].includes(status) || (["sent", "cancelled"].includes(status) && waitingAtResend > 0)) && (
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={pending} onClick={() => setConfirmCancel(true)}>
          Stop the rest
        </button>
      )}
      {msg && <span className="text-sm text-[var(--danger-text)]">{msg}</span>}
      {confirmCancel && (
        <ConfirmModal
          title="Stop this email?"
          description="Anything not yet sent is cancelled, including emails waiting at Resend for later. What already went can't be taken back."
          confirmLabel="Stop it"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => {
            setConfirmCancel(false);
            act(
              () => cancelCampaign(id),
              (r) => {
                // A big list takes more than one go (Resend cancels one at a time).
                const left = (r as { left?: number }).left ?? 0;
                if (left > 0) setMsg(`${left} still waiting at Resend: press "Stop the rest" again.`);
              },
            );
          }}
        />
      )}
    </div>
  );
}
