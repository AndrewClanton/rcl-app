"use client";

import { useState, useTransition } from "react";
import { rereadMemberPayments } from "./actions";

// Reports -> Members: read every membership payment from Stripe again (the
// page reads recent ones by itself every 10 minutes).
export default function RereadButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)] disabled:opacity-60"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            const r = await rereadMemberPayments().catch(() => ({ ok: false as const, error: "Couldn't read Stripe just now. Try again in a minute." }));
            setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? "Reading Stripe…" : "Re-read from Stripe"}
      </button>
      {result && <p className={`text-xs ${result.ok ? "text-[var(--muted)]" : "text-[var(--danger-text)]"}`}>{result.text}</p>}
    </div>
  );
}
