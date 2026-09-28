"use client";

import { useRouter } from "next/navigation";

// Jump to any business day; the page re-renders for it.
export default function DateJump({ date, max, days }: { date: string; max: string; days: string | undefined }) {
  const router = useRouter();
  return (
    <input
      type="date"
      aria-label="Pick a day"
      className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
      value={date}
      max={max}
      onChange={(e) => {
        const q = new URLSearchParams();
        if (e.target.value && e.target.value !== max) q.set("date", e.target.value);
        if (days) q.set("days", days);
        const s = q.toString();
        router.push(`/admin/reports${s ? `?${s}` : ""}`);
      }}
    />
  );
}
