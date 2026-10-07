"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDailyCapAction, saveResendPlan, saveWaveModeAction, saveWaveSizeAction } from "../ready/actions";

// Admins: how waves go and our email plan's numbers. Moved here from
// Ready to send as they were; each action checks for an admin itself.

export interface PlanNumbers {
  daily: number;
  monthly: number;
  reserve: number;
  cap: number;
  perDay: number;
  auto: boolean;
}

const n = (x: number) => x.toLocaleString("en-US");

// How many each day's wave goes to (Resend's daily figure becomes this
// plus what's kept back for receipts).
function WaveSize({ plan }: { plan: PlanNumbers }) {
  const router = useRouter();
  const [size, setSize] = useState(String(plan.perDay));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        Wave size
        <input className="input mt-1 min-h-11 !w-28" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn-secondary min-h-11 !px-4 !py-2 text-sm"
        disabled={pending || Number(size) === plan.perDay}
        onClick={() =>
          start(async () => {
            const out = await saveWaveSizeAction(Number(size)).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            setMsg(out.ok ? `Saved: waves of ${n(out.size)} from the next wave.` : out.error);
            router.refresh();
          })
        }
      >
        Save
      </button>
      {msg && <span className="text-sm">{msg}</span>}
    </div>
  );
}

// The most member email in one day, every email together (Send to
// everyone now included). 2,000 unless an admin sets another.
function DailyCap({ plan }: { plan: PlanNumbers }) {
  const router = useRouter();
  const [cap, setCap] = useState(String(plan.cap));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        Most member emails a day
        <input className="input mt-1 min-h-11 !w-28" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn-secondary min-h-11 !px-4 !py-2 text-sm"
        disabled={pending || Number(cap) === plan.cap}
        onClick={() =>
          start(async () => {
            const out = await saveDailyCapAction(Number(cap)).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
            setMsg(out.ok ? `Saved: at most ${n(out.cap)} a day.` : out.error);
            router.refresh();
          })
        }
      >
        Save
      </button>
      {msg && <span className="text-sm">{msg}</span>}
    </div>
  );
}

// Whether waves after the first wait for staff to press "Send the next
// wave" (the default) or go by themselves each morning.
function WaveMode({ plan }: { plan: PlanNumbers }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const pick = (auto: boolean) => {
    if (auto === plan.auto) return;
    if (auto && !window.confirm("Waves would then go out by themselves each morning, with nobody pressing anything. Switch?")) return;
    start(async () => {
      const out = await saveWaveModeAction(auto).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      setMsg(out.ok ? "Saved." : out.error);
      router.refresh();
    });
  };
  return (
    <fieldset className="text-sm">
      <legend className="text-[var(--muted)]">Waves after the first</legend>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={!plan.auto} className={`chip min-h-11 !px-3 ${!plan.auto ? "chip-selected" : ""}`} disabled={pending} onClick={() => pick(false)}>
          Only when staff press Send the next wave
        </button>
        <button type="button" aria-pressed={plan.auto} className={`chip min-h-11 !px-3 ${plan.auto ? "chip-selected" : ""}`} disabled={pending} onClick={() => pick(true)}>
          By themselves each morning
        </button>
        {msg && <span>{msg}</span>}
      </div>
    </fieldset>
  );
}

function PlanEditor({ plan }: { plan: PlanNumbers }) {
  const router = useRouter();
  const [daily, setDaily] = useState(String(plan.daily));
  const [monthly, setMonthly] = useState(String(plan.monthly));
  const [reserve, setReserve] = useState(String(plan.reserve));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center text-[var(--muted)]">Upgraded the Resend plan? Change the numbers</summary>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label>
          A day
          <input className="input mt-1 min-h-11 !w-28" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </label>
        <label>
          A month
          <input className="input mt-1 min-h-11 !w-28" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </label>
        <label>
          Kept back each day for receipts
          <input className="input mt-1 min-h-11 !w-28" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-secondary min-h-11 !px-4 !py-2 text-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const out = await saveResendPlan(Number(daily), Number(monthly), Number(reserve), plan.cap).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
              setMsg(out.ok ? "Saved." : out.error);
              router.refresh();
            })
          }
        >
          Save
        </button>
        {msg && <span>{msg}</span>}
      </div>
    </details>
  );
}

export default function PlanEditors({ plan }: { plan: PlanNumbers }) {
  return (
    <div className="space-y-4">
      <WaveMode plan={plan} />
      <WaveSize plan={plan} />
      <DailyCap plan={plan} />
      <PlanEditor plan={plan} />
    </div>
  );
}
