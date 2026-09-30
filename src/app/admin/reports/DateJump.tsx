"use client";

import { useRouter } from "next/navigation";

// Jump to any day (or month); the page re-renders for it. `keep` carries
// the page's other settings along, and `omit` is the value that's the
// page's default (today, this month), left out of the address.
export default function DateJump({
  date,
  max,
  min,
  path = "/admin/reports",
  param = "date",
  type = "date",
  keep = {},
  omit,
  label = "Pick a day",
}: {
  date: string;
  max?: string;
  min?: string;
  path?: string;
  param?: string;
  type?: "date" | "month";
  keep?: Record<string, string | undefined>;
  omit?: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <input
      type={type}
      aria-label={label}
      className="h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
      value={date}
      max={max}
      min={min}
      onChange={(e) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
        if (e.target.value && e.target.value !== (omit ?? max)) q.set(param, e.target.value);
        const s = q.toString();
        router.push(`${path}${s ? `?${s}` : ""}`);
      }}
    />
  );
}
