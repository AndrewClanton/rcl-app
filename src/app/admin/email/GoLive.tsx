"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import type { GoLive as GoLiveData } from "@/lib/email/go-live";
import { markUnsubscribeTested, setSendingSwitch } from "./actions";

// The Email page's go-live checklist, with the owners' Sending on/off switch
// (the everyday switch under the Vercel master setting) and the one hand
// tick (the unsubscribe link was tried).

function Mark({ ok }: { ok: boolean | null }) {
  const [sign, tone, label] = ok === true ? ["✓", "text-[var(--success-text)]", "Done"] : ok === false ? ["✗", "text-[var(--danger-text)]", "Not yet"] : ["?", "text-[var(--warn-text)]", "Couldn't check"];
  return (
    <span className={`inline-block w-5 shrink-0 text-center font-bold ${tone}`} role="img" aria-label={label} title={label}>
      {sign}
    </span>
  );
}

function SendingSwitch({ on, masterOn, canFlip }: { on: boolean; masterOn: boolean; canFlip: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flip = () =>
    start(async () => {
      const r = await setSendingSwitch(!on).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });
  return (
    <div id="sending" className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${on ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--border)]"}`}>
          Sending is {on ? "on" : "off"}
        </span>
        {canFlip ? (
          <button
            type="button"
            className={`${on ? "btn-secondary text-[var(--danger-text)]" : "btn-primary"} !px-3 !py-1 text-xs`}
            disabled={pending}
            onClick={() => setConfirm(true)}
          >
            {pending ? "Saving…" : on ? "Turn sending off" : "Turn sending on"}
          </button>
        ) : (
          <span className="text-xs text-[var(--muted)]">An owner can turn it {on ? "off" : "on"} here.</span>
        )}
      </div>
      {!masterOn && <p className="text-xs text-[var(--muted)]">The master setting in Vercel is off too, so nothing goes until an owner turns that on as well.</p>}
      {msg && <p className={`text-xs ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
      {confirm && (
        <ConfirmModal
          title={on ? "Turn sending off?" : "Turn sending on?"}
          description={
            on
              ? "Nothing more goes to a list, starting now, and email waiting at Resend to go out later is called back. Receipts, password resets and sign-up links still go."
              : "Emails to lists can go again: when someone presses Send on them, or at the time they were scheduled for. Nothing goes by itself just because this is on."
          }
          confirmLabel={on ? "Turn it off" : "Turn it on"}
          danger={on}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            flip();
          }}
        />
      )}
    </div>
  );
}

function UnsubscribeTick({ done }: { done: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary !px-3 !py-1 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await markUnsubscribeTested(!done).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            setError(r.ok ? null : r.error);
            router.refresh();
          })
        }
      >
        {done ? "Untick" : "I tried it: it works"}
      </button>
      {error && <span className="text-xs text-[var(--danger-text)]">{error}</span>}
    </span>
  );
}

export default function GoLive({ data, isOwner }: { data: GoLiveData; isOwner: boolean }) {
  const done = data.items.filter((i) => i.ok === true).length;
  const all = done === data.items.length;
  return (
    <details open={!all} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <summary className="cursor-pointer">
        <span className="font-semibold">Go-live checklist</span>{" "}
        <span className="text-[var(--muted)]">
          · {done} of {data.items.length} done{all ? ", ready to send" : ""} · sending is {data.switchOn && data.masterOn ? "on" : "off"}
        </span>
      </summary>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {data.items.map((i) => (
          <li key={i.key} className="flex gap-2 py-2">
            <Mark ok={i.ok} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">{i.label}</span>
                {i.detail && <span className="text-xs text-[var(--muted)]">{i.detail}</span>}
                {i.key === "unsubscribe" && <UnsubscribeTick done={data.unsubscribeTested} />}
              </div>
              <p className="text-xs text-[var(--muted)]">{i.about}</p>
              {i.key === "switch" && <SendingSwitch on={data.switchOn} masterOn={data.masterOn} canFlip={isOwner} />}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
