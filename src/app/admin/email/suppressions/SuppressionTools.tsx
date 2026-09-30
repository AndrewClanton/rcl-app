"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockAddress, checkAddress, unblockAddress } from "../actions";

const REASON: Record<string, string> = {
  hard_bounce: "on the list: it hard-bounced. It comes off when the member's address changes.",
  complaint: "on the list: they marked an email as spam. Only they can turn email back on, from their account or an email link.",
  soft_bounce_repeat: "on the list: it kept bouncing.",
  resend_suppressed: "on the list: Resend refused it.",
  unsubscribed: "on the list: they had unsubscribed before their account was removed. Only they can turn email back on, from their account or an email link.",
  manual: "on the list: blocked by hand.",
};

export default function SuppressionTools() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; manual?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const go = (fn: () => Promise<{ ok: boolean; text: string; manual?: boolean }>) =>
    start(async () => {
      setResult(await fn().catch(() => ({ ok: false, text: "Couldn't reach the server." })));
      router.refresh();
    });

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-2 font-semibold">Check or block an address</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-auto min-w-64 flex-1 text-sm" type="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button
          type="button"
          className="btn-secondary !px-4 !py-2 text-sm"
          disabled={pending || !email.includes("@")}
          onClick={() =>
            go(async () => {
              const r = await checkAddress(email);
              if (!r.ok) return { ok: false, text: r.error };
              return r.reason ? { ok: true, text: `That address is ${REASON[r.reason] ?? "on the list."}`, manual: r.reason === "manual" } : { ok: true, text: "That address isn't on the list." };
            })
          }
        >
          Check
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="input !w-auto min-w-64 flex-1 text-sm" placeholder="Why (optional, no addresses)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          type="button"
          className="btn-primary !px-4 !py-2 text-sm"
          disabled={pending || !email.includes("@")}
          onClick={() =>
            go(async () => {
              const r = await blockAddress(email, note);
              return r.ok ? { ok: true, text: "Blocked. No marketing email will go to that address." } : { ok: false, text: r.error };
            })
          }
        >
          Block this address
        </button>
        {result?.manual && (
          <button
            type="button"
            className="btn-secondary !px-4 !py-2 text-sm"
            disabled={pending}
            onClick={() =>
              go(async () => {
                const r = await unblockAddress(email);
                return r.ok ? { ok: true, text: "Unblocked." } : { ok: false, text: r.error };
              })
            }
          >
            Lift the block
          </button>
        )}
      </div>
      {result && <p className={`mt-2 text-sm ${result.ok ? "" : "text-[var(--danger-text)]"}`}>{result.text}</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">The address is scrambled on the server to check it; it isn&apos;t saved anywhere.</p>
    </section>
  );
}
