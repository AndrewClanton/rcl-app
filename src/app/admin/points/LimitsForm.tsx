"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettings } from "./actions";
import type { PointsSettings } from "@/lib/rewards-server";

// The earning ceilings and the goods limits (points_settings). 0 means no
// limit. Each reward can have its own daily and monthly limit too (Rewards).
export default function LimitsForm({ settings }: { settings: PointsSettings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const field = (key: keyof PointsSettings, label: string, help: string) => (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        className="input mt-1 w-40"
        value={s[key]}
        onChange={(e) => {
          setS({ ...s, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) });
          setMsg(null);
        }}
      />
      <span className="mt-1 block text-xs text-[var(--muted)]">{help}</span>
    </label>
  );
  return (
    <section className="max-w-2xl space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">Earning, per member per day</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          A day is 4 AM to 4 AM. Check-in points already pay once a day. Anything over a ceiling isn&apos;t paid, and shows on the watch list.
        </p>
      </div>
      {field("bonusDailyCap", "Check-in and badge points, at most", "600 covers the biggest real day: a 52-week badge in a birthday week.")}
      {field("earnDailyCap", "Everything earned, at most", "Purchases, check-ins and badges together. Staff credits and refunds don't count.")}
      <div>
        <h2 className="text-base font-semibold">Redeeming real goods, per member</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Across every good in the catalog. Each reward can also have its own limit.</p>
      </div>
      {field("goodsDailyLimit", "Goods a day", "Popcorn, a soda, a drink, a ticket, a booth hour...")}
      {field("goodsMonthlyLimit", "Goods a month", "")}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await saveSettings(s).catch(() => ({ ok: false as const, error: "That didn't save." }));
            setBusy(false);
            setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          }}
        >
          {busy ? "Saving…" : "Save limits"}
        </button>
        {msg && <span className={`text-sm font-semibold ${msg.ok ? "" : "text-[var(--danger-text)]"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
