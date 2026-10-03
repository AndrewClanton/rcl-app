"use client";

import { useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/deployment";
import { approveOwnerRate, type OwnerRateApproval } from "./owner-rate-actions";

// "Owner rate" on the register: pick whose it is (only the people ticked in
// Back office, Owner tab), then that owner types their own PIN. Nobody else's
// PIN works, so the owner rate can't be given to someone else.

export type OwnerRateOn = Extract<OwnerRateApproval, { ok: true }>;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export default function OwnerRateModal({
  owners,
  onApproved,
  onCancel,
}: {
  owners: { id: string; name: string }[];
  onApproved: (approval: OwnerRateOn) => void;
  onCancel: () => void;
}) {
  // One owner: straight to their PIN.
  const [pick, setPick] = useState<{ id: string; name: string } | null>(owners.length === 1 ? owners[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pick || busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await approveOwnerRate(pick.id, pin);
      if (r.ok) return onApproved(r);
      setError(r.error);
      setPin("");
    } catch (e) {
      setError(isStaleBuildError(e) ? STALE_BUILD_MESSAGE : "Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {pick ? `${first(pick.name)}'s owner rate` : "Owner rate: whose?"}
          <InfoTip topic="owner-rate" />
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Menu items at cost, on the owner&apos;s monthly tab. Only the owner, with their own PIN.
        </p>

        {!pick ? (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {owners.map((o) => (
              <button key={o.id} className="btn-secondary min-h-14 !text-base" onClick={() => setPick(o)}>
                {first(o.name)}
              </button>
            ))}
          </div>
        ) : (
          <>
            <label className="mt-4 block text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {first(pick.name)}, enter your PIN
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                aria-label={`${first(pick.name)}'s PIN`}
                className="input mt-2 min-h-12 text-center text-lg tracking-[0.5em]"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
              />
            </label>
            {error && (
              <div className="mt-2 text-xs" style={{ color: "var(--danger-text)" }}>
                {error}
              </div>
            )}
            <button className="btn-primary mt-4 min-h-12 w-full !text-base" disabled={busy || pin.length < 4} onClick={() => void submit()}>
              {busy ? "Checking..." : "Use the owner rate"}
            </button>
            {owners.length > 1 && (
              <button
                className="mt-2 min-h-11 text-sm hover:underline"
                style={{ color: "var(--muted)" }}
                onClick={() => {
                  setPick(null);
                  setPin("");
                  setError(null);
                }}
              >
                Not {first(pick.name)}? Pick again
              </button>
            )}
          </>
        )}

        <button className="mt-2 block min-h-11 w-full text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
