"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Automation } from "@/lib/email/types";
import { setAutomationOn } from "../actions";

export default function AutomationSwitch({ automation, on, canChange }: { automation: Automation; on: boolean; canChange: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="text-right">
      <label className={`flex items-center gap-2 text-sm font-semibold ${canChange ? "cursor-pointer" : ""}`}>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={on}
          disabled={!canChange || pending}
          onChange={(e) =>
            start(async () => {
              setError(null);
              const r = await setAutomationOn(automation, e.target.checked).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
              if (!r.ok) setError(r.error);
              router.refresh();
            })
          }
        />
        {on ? "On" : "Off"}
      </label>
      {!canChange && <div className="text-xs text-[var(--muted)]">Admins switch these</div>}
      {error && <div className="text-xs text-[var(--danger-text)]">{error}</div>}
    </div>
  );
}
