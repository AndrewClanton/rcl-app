"use client";

import { useState } from "react";
import { flagFromWatchList } from "./actions";

// "Flag": puts the watch list's reason in the member flag system, to look
// into on their page. Nothing is blocked.
export default function FlagButton({ memberId, reason, flagged }: { memberId: string; reason: string; flagged: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(flagged ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "done") {
    return (
      <a href={`/admin/members/${memberId}`} className="chip shrink-0">
        🚩 See flag
      </a>
    );
  }
  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        className="chip"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await flagFromWatchList(memberId, reason).catch(() => ({ ok: false as const, error: "That didn't go through." }));
          if (r.ok) setState("done");
          else {
            setError(r.error);
            setState("error");
          }
        }}
      >
        {state === "busy" ? "Flagging…" : "🚩 Flag"}
      </button>
      {error && <p className="mt-1 text-xs text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
