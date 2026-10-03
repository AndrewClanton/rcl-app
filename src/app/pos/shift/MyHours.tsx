"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatHours } from "@/lib/hours";
import { getShiftWeekHours } from "../hours-actions";

// "My hours: 12 h 30 m this week" on the Staff sheet, for whoever this iPad
// says is using it. Tapping it opens their hours in the back office.
export default function MyHours({ shiftId, name }: { shiftId: string; name: string }) {
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
  return (
    <Link
      href={`/admin/my-hours?shift=${shiftId}`}
      className="flex min-h-16 flex-col items-start justify-center rounded-lg border-2 px-3 py-2 text-left"
      style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}
    >
      <span className="font-bold">My hours</span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {name}: <span className="font-semibold tabular-nums">{known === undefined ? "…" : known === null ? "see the week" : formatHours(known)}</span> this week
      </span>
    </Link>
  );
}
