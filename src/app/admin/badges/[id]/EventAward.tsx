"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { awardEventBadgeNow } from "../actions";

// An event badge: what it's for, and "Award to everyone who came" (a dry
// run first). It also goes out on its own as people come.
export default function EventAward({ defId, target, active }: { defId: string; target: string; active: boolean }) {
  const router = useRouter();
  const [count, setCount] = useState<{ came: number; toAward: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (dryRun: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await awardEventBadgeNow(defId, dryRun);
      if (!r.ok) return setMsg(r.error);
      if (dryRun) return setCount({ came: r.came, toAward: r.toAward });
      setCount(null);
      setMsg(r.awarded ? `Awarded to ${r.awarded.toLocaleString("en-US")}.` : "Nobody new to award.");
      router.refresh();
    });
  return (
    <div className="space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <div>
        <span className="font-bold">For:</span> {target}
      </div>
      <p className="text-[var(--muted)]">It goes to people on its own as they come: a ticket for the showing, or a check-in that day for an event.</p>
      {active && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary px-3 py-2 disabled:opacity-50" disabled={pending} onClick={() => go(true)}>
            Count who came (dry run)
          </button>
          {count && (
            <>
              <span>
                {count.came.toLocaleString("en-US")} came · {count.toAward.toLocaleString("en-US")} still to get it
              </span>
              {count.toAward > 0 && (
                <button type="button" className="btn-primary px-3 py-2 disabled:opacity-50" disabled={pending} onClick={() => go(false)}>
                  Award to {count.toAward.toLocaleString("en-US")}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {msg && (
        <p className="font-bold" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
