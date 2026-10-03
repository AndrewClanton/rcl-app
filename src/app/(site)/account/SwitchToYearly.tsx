"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { previewSwitchToYearly, switchToYearly, type YearlyPreview } from "./actions";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// For monthly Insiders+ members: see exactly what switching costs today,
// then confirm. The year starts the day they switch.
export default function SwitchToYearly({ yearlyLabel }: { yearlyLabel: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Extract<YearlyPreview, { ok: true }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <p className="notice notice-success text-sm">You&apos;re on yearly Insiders+ now. Thanks for sticking with us!</p>;

  return (
    <div className="rounded-xl border-2 border-[var(--foreground)] bg-[var(--gold)] p-4 text-[var(--gold-foreground)]">
      {!preview ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <strong>Save 15% by paying yearly:</strong> {yearlyLabel}, plus tax.
          </p>
          <button
            className="btn-primary min-h-11 w-full !px-4 !py-2 text-sm sm:w-auto"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await previewSwitchToYearly().catch(() => ({ ok: false as const, error: "Couldn't reach billing. Try again." }));
              setBusy(false);
              if (!r.ok) return setError(r.error);
              setPreview(r);
            }}
          >
            {busy ? "One moment…" : "Switch to yearly"}
          </button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            You&apos;ll pay <strong>{money(preview.amountDue)}</strong> today: {money(preview.yearly)} for the year plus tax, less a credit for the part of this month you&apos;ve
            already paid for. Your membership then renews on <strong>{preview.renewsOn}</strong>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary min-h-11 !px-4 !py-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await switchToYearly().catch(() => ({ ok: false as const, error: "The switch didn't go through. Nothing was changed." }));
                setBusy(false);
                if (!r.ok) return setError(r.error);
                setDone(true);
                router.refresh();
              }}
            >
              {busy ? "Switching…" : `Pay ${money(preview.amountDue)} and switch`}
            </button>
            <button className="btn-secondary min-h-11 !px-4 !py-2" disabled={busy} onClick={() => setPreview(null)}>
              Not now
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
