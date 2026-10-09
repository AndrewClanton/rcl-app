"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { problemSentence, readStatus, scheduleProblem, type CalendarSyncStatus } from "@/lib/calendar-status";

// "Schedule not checked since 2:07 PM, so the website's showtimes may be
// wrong." Red, when the last schedule check (settings.calendar_sync_status)
// is over an hour old or failed. At the top of Back office, and a slim strip
// on the register: in the page's flow, never over the order or payment, and
// it blocks nothing. Asks again every 5 minutes, and works out "over an
// hour" every minute, so a register left open all night stays right.
// Managers get "Check now" (Sync from calendar).
export default function ScheduleCheckBanner({ initial, canCheck, slim = false }: { initial: CalendarSyncStatus | null; canCheck: boolean; slim?: boolean }) {
  const [status, setStatus] = useState(initial);
  // null until mounted: the time is the browser's, so nothing renders on
  // the server (no mismatch).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => setNow(Date.now());
    const load = async () => {
      try {
        const r = await fetch("/api/schedule-check", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { status: unknown };
        if (alive) setStatus(readStatus(j.status));
      } catch {
        // Offline for a moment: keep what we have.
      }
      tick();
    };
    tick();
    const clock = setInterval(tick, 60_000);
    const poll = setInterval(load, 5 * 60_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(clock);
      clearInterval(poll);
      window.removeEventListener("focus", load);
    };
  }, []);

  if (now === null) return null;
  const problem = scheduleProblem(status, now);
  if (!problem) return null;
  const text = problemSentence(problem, now);
  const check = canCheck && (
    // On the register it opens in a new tab, so the sale on screen stays put.
    <Link href="/admin/screenings/sync" className="shrink-0 font-bold underline" {...(slim ? { target: "_blank", rel: "noopener" } : {})}>
      Check now
    </Link>
  );

  if (slim) {
    return (
      <div role="status" className="mb-1 flex items-center gap-3 rounded-md px-3 py-1 text-xs font-medium text-white print:hidden" style={{ background: "var(--danger-text)" }}>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {check}
      </div>
    );
  }
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white print:hidden" style={{ background: "var(--danger-text)" }}>
      <span>{text}</span>
      {check && <span className="inline-flex min-h-11 items-center">{check}</span>}
    </div>
  );
}
