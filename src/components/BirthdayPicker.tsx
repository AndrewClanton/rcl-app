"use client";

import { MONTH_NAMES } from "@/lib/visits";

const daysIn = (month: string) => (month ? new Date(Date.UTC(2000, Number(month), 0)).getUTCDate() : 31);

// A birthday as a month and a day (no year: only those count, for the
// Birthday Visit badge in lib/visits.ts). The value is "12-30", "" for
// none, or half picked ("12-") until both are; birthdayFromInput reads it.
export default function BirthdayPicker({ value, onChange, className = "", id }: { value: string; onChange: (value: string) => void; className?: string; id?: string }) {
  const [month = "", day = ""] = value.split("-");
  const set = (m: string, d: string) => onChange(m || d ? `${m}-${d}` : "");
  return (
    <div className="flex gap-2">
      <select
        id={id}
        aria-label="Birthday month"
        className={className}
        value={month}
        onChange={(e) => set(e.target.value, day && Number(day) <= daysIn(e.target.value) ? day : "")}
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label="Birthday day" className={className} value={day} onChange={(e) => set(month, e.target.value)}>
        <option value="">Day</option>
        {Array.from({ length: daysIn(month) }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </select>
    </div>
  );
}
