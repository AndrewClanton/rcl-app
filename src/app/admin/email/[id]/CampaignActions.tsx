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
  const [msgOk, setMsgOk] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: (r: unknown) => void) =>
    start(async () => {
      setMsg(null);
      setMsgOk(false);
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
      {msg && <span className={`text-sm ${msgOk ? "" : "text-[var(--danger-text)]"}`}>{msg}</span>}
      {confirmCancel && (
        <ConfirmModal
          title="Stop this email?"
          description="Anything not yet sent is cancelled, including emails waiting at Resend for later. What already went can't be taken back."
          confirmLabel="Stop it"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => {
            setConfirmCancel(false);
            start(async () => {
              setMsg(null);
              setMsgOk(false);
              // A big list takes more than one go (Resend cancels one email
              // at a time): carry on, round after round, while the page is open.
              let stopped = 0;
              let r = await cancelCampaign(id).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
              for (let round = 0; r.ok && r.left > 0 && r.stopped > 0 && !r.busy && round < 30; round++) {
                stopped += r.stopped;
                setMsg(`Stopping: ${stopped.toLocaleString()} called back from Resend so far, about ${r.left.toLocaleString()} to go. Keep this page open.`);
                r = await cancelCampaign(id).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
              }
              if (!r.ok) setMsg(stopped ? `${stopped.toLocaleString()} called back, then it stopped: ${r.error} Press "Stop the rest" to carry on.` : r.error);
              else if (r.busy)
                setMsg(
                  `Stopped, but another call-back from Resend is running right now, so ${r.left.toLocaleString()} of this email's still wait there. Press "Stop the rest" again in a few minutes.`,
                );
              else if (r.left > 0) setMsg(`${(stopped + r.stopped).toLocaleString()} called back from Resend; ${r.left.toLocaleString()} still waiting there: press "Stop the rest" again.`);
              else {
                setMsgOk(true);
                setMsg(`Stopped.${stopped + r.stopped ? ` ${(stopped + r.stopped).toLocaleString()} called back from Resend.` : ""}`);
              }
              router.refresh();
            });
          }}
        />
      )}
    </div>
  );
}
