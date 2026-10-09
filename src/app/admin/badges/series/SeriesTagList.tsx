"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSeriesTag, setSeriesTagActive } from "../actions";

// The series list: add one, or switch one off (it leaves the pickers;
// showings already tagged keep it).
export default function SeriesTagList({ tags }: { tags: { name: string; active: boolean; used: number }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.();
      router.refresh();
    });
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <ul>
        {tags.map((t) => (
          <li key={t.name} className={`flex min-h-12 flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-2 first:border-t-0 ${t.active ? "" : "text-[var(--muted)]"}`}>
            <span className="font-bold">{t.name}</span>
            <span className="text-sm text-[var(--muted)]">
              {t.used.toLocaleString("en-US")} tagged{t.active ? "" : " · off"}
            </span>
            <button type="button" className="btn-secondary ml-auto px-3 py-1.5 text-sm disabled:opacity-50" disabled={pending} onClick={() => run(() => setSeriesTagActive(t.name, !t.active))}>
              {t.active ? "Switch off" : "Switch on"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] px-4 py-3">
        <label className="text-sm font-bold">
          New tag
          <input
            className="mt-1 block w-64 rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Karaoke"
          />
        </label>
        <button type="button" className="btn-primary px-4 py-2 disabled:opacity-50" disabled={pending || name.trim().length < 2} onClick={() => run(() => addSeriesTag(name), () => setName(""))}>
          Add
        </button>
        {error && (
          <span className="text-sm font-bold text-[var(--accent)]" role="alert">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
