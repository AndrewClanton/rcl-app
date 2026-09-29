"use client";

import { useState } from "react";
import { sendDailyReportNow } from "./actions";

export default function SendNow({ date, disabled }: { date: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        className="btn-primary !px-4 !py-2 text-sm"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          setError(null);
          const r = await sendDailyReportNow(date).catch(() => ({ ok: false as const, error: "Couldn't send. Try again." }));
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setResult(
            [r.sent.length ? `Sent to ${r.sent.join(", ")}.` : "", r.failed.length ? `Not sent to ${r.failed.map((f) => `${f.to} (${f.error})`).join("; ")}.` : ""].filter(Boolean).join(" ") || "Nobody to send to.",
          );
        }}
      >
        {busy ? "Sending…" : "Send this to the admins now"}
      </button>
      {result && <p className="text-sm">{result}</p>}
      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
