"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatHours } from "@/lib/hours";
import { getShiftWeekHours } from "../hours-actions";

// "My hours: 12 h 30 m this week" on the shift bar, for whoever this iPad
// says is using it. Tapping it opens their hours in the back office. A slim
// line under the bar's buttons: the button row has no room left on an iPad.
export default function MyHours({ shiftId }: { shiftId: string }) {
  const [hours, setHours] = useState<{ shiftId: string; hours: number | null } | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      getShiftWeekHours(shiftId)
        .then((r) => live && setHours({ shiftId, hours: r.ok ? r.hours : null }))
        .catch(() => {}); // offline for a moment: keep what's showing, the next load retries
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [shiftId]);

  const known = hours?.shiftId === shiftId ? hours.hours : undefined;
  if (known === null) return null;
  return (
    <div className="-mb-1 mt-0.5 flex justify-end">
      {/* Padding for a bigger tap target, pulled back so the line stays slim. */}
      <Link href={`/admin/my-hours?shift=${shiftId}`} className="-my-1.5 whitespace-nowrap px-1 py-1.5 text-[11px] leading-4 underline-offset-2 hover:underline" style={{ color: "var(--muted)" }}>
        My hours: <span className="font-semibold tabular-nums">{known === undefined ? "…" : formatHours(known)}</span> this week
      </Link>
    </div>
  );
}
