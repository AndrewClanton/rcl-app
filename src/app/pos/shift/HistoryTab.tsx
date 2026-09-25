"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import type { OpsHistory } from "../ops-actions";
import { TIMING_LABEL } from "@/lib/ops/shared";

const TZ = "America/Chicago";
const dayHead = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return { dow: d.toLocaleDateString("en-US", { weekday: "short" }), md: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) };
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });

// The running tally: what got done each day this week and by whom, recent
// par counts, and every change to the lists.
export default function HistoryTab() {
  const api = useOpsApi();
  const [h, setH] = useState<OpsHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getOpsHistory(7)
      .then((d) => alive && setH(d))
      .catch(() => alive && setError("Couldn't load the history. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);

  if (error) return <p style={{ color: "var(--danger-text)" }}>{error}</p>;
  if (!h) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  const tick = new Map(h.ticks.map((t) => [`${t.taskId}:${t.date}`, t.byName]));
  const dates = [...h.dates].reverse();
  const totalTicks = h.ticks.length;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-2xl">This week</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          {totalTicks} task{totalTicks === 1 ? "" : "s"} done in the last 7 days
          {h.totals.length ? ` · ${h.totals.map((t) => `${t.name} ${t.count}`).join(" · ")}` : ""}
        </p>
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  Task
                </th>
                {dates.map((d) => {
                  const x = dayHead(d);
                  return (
                    <th key={d} className="px-2 py-2 text-center text-xs font-bold" style={{ color: "var(--muted)" }}>
                      {x.dow}
                      <span className="block font-normal">{x.md}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {h.tasks.map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-2">
                    <span className="font-bold">{t.title}</span>
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {TIMING_LABEL[t.timing]}
                      {!t.active && " · removed"}
                    </span>
                  </td>
                  {dates.map((d) => {
                    const k = `${t.id}:${d}`;
                    const has = tick.has(k);
                    return (
                      <td key={d} className="px-2 py-2 text-center">
                        {has ? (
                          <span className="inline-block rounded px-1.5 py-0.5 text-xs font-bold" style={{ background: "var(--success-bg)", color: "var(--success-text)" }}>
                            ✓ {tick.get(k) ?? ""}
                          </span>
                        ) : (
                          <span style={{ color: "var(--border)" }}>·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-display mb-3 text-xl">Par counts</h2>
        {h.counts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No counts yet.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            {h.counts.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-3 px-4 py-2.5 text-sm">
                <span>
                  <strong>{when(c.at)}</strong>
                  {c.byName ? ` · ${c.byName}` : ""}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {c.items} counted · <strong style={{ color: c.below ? "var(--warn-text)" : undefined }}>{c.below} under par</strong>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display mb-3 text-xl">Changes to the lists</h2>
        {h.changes.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No changes yet.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {h.changes.map((c, i) => (
              <li key={i}>
                <span style={{ color: "var(--muted)" }}>{when(c.at)}</span> · {c.byName ?? "Someone"} {c.action} {c.summary}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
