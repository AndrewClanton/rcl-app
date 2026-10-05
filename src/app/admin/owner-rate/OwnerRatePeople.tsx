"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOwnerRate } from "./actions";

import type { OwnerRateCandidate } from "@/lib/data/owner-rate";

// "Who gets the owner rate": a tick per owner (employees.owner_rate). Owners
// change it; only active owner logins are listed.

export default function OwnerRatePeople({ candidates }: { candidates: OwnerRateCandidate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ticked = candidates.filter((c) => c.ticked);
  const flip = (c: OwnerRateCandidate, on: boolean) =>
    start(async () => {
      const out = await setOwnerRate(c.id, on).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      setMsg(out.ok ? { ok: true, text: out.message } : { ok: false, text: out.error });
      router.refresh();
    });

  return (
    <section id="who" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
      <h2 className="text-base font-semibold">Who gets the owner rate</h2>
      <p className="mt-1 text-[var(--muted)]">
        When a ticked owner&apos;s own account is on an order, the register shows an Owner rate tick beside Tax exempt. Their account is the member account that
        shares their login.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={c.ticked} disabled={pending} onChange={(e) => flip(c, e.target.checked)} />
              <span className="font-semibold">{c.name}</span>
              {!c.hasAccount && <span className="ml-auto text-xs text-[var(--danger-text)]">no member account yet</span>}
            </label>
          </li>
        ))}
      </ul>
      {ticked.length === 0 && <p className="mt-2 text-xs">Nobody is ticked yet, so the register doesn&apos;t offer the owner rate.</p>}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
    </section>
  );
}
