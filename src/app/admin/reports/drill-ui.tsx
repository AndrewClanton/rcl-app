"use client";

import DrillLink from "./DrillLink";

// Pieces the Day report's drill-downs (DayDrill, TipsDrill) are made of.

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// A clock time, Central (the same on the server and in the browser).
export function time(iso: string | number) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

export function shortDay(iso: string | number) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Chicago" });
}

export function Section({ title, subtitle, action, children }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {action && <div className="ml-auto text-sm">{action}</div>}
        {subtitle && <p className="w-full text-xs text-[var(--muted)]">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export type Line = { label: React.ReactNode; value: React.ReactNode; href?: string; strong?: boolean; muted?: boolean; key?: string };

// Label and figure per line; a line with an href opens that drill-down.
export function Lines({ rows }: { rows: Line[] }) {
  return (
    <ul className="divide-y divide-[var(--border)] text-sm">
      {rows.map((l, i) => {
        const cls = `flex items-baseline justify-between gap-3 py-1.5 ${l.strong ? "font-semibold" : ""} ${l.muted ? "text-[var(--muted)]" : ""}`;
        return (
          <li key={l.key ?? i}>
            {l.href ? (
              <DrillLink replace href={l.href} className={`${cls} -mx-1.5 rounded-md px-1.5 hover:bg-[var(--surface-hover)]`}>
                <span className="min-w-0">{l.label}</span>
                <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                  {l.value}
                  <span aria-hidden className="text-[var(--muted)]">
                    ›
                  </span>
                </span>
              </DrillLink>
            ) : (
              <div className={cls}>
                <span className="min-w-0">{l.label}</span>
                <span className="shrink-0 tabular-nums">{l.value}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
