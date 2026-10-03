"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOwnerRate } from "./actions";

// "Who gets the owner rate": a tick per person (employees.owner_rate), not a
// role, the way Email picks who sends. Owners change it; only active staff
// logins are listed. Nobody is ticked until an owner ticks them.

export interface OwnerRateCandidate {
  id: string;
  name: string;
  role: string;
  ticked: boolean;
}

const ROLE: Record<string, string> = { cashier: "Staff", manager: "Manager", admin: "Admin", owner: "Owner" };

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
        A tick on the person, not their role. Only someone ticked here shows up under Owner rate on the register, and only their own PIN puts an order on their tab.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={c.ticked} disabled={pending} onChange={(e) => flip(c, e.target.checked)} />
              <span className="font-semibold">{c.name}</span>
              <span className="ml-auto text-xs text-[var(--muted)]">{ROLE[c.role] ?? c.role}</span>
            </label>
          </li>
        ))}
      </ul>
      {ticked.length === 0 && <p className="mt-2 text-xs">Nobody is ticked yet, so the register doesn&apos;t offer the owner rate.</p>}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
    </section>
  );
}
