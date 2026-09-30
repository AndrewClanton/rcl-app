"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import { changeLabel, qtyUnit, type CountChange, type CountComparison, type CountRef } from "@/lib/ops/shared";

// "Since the last count": what each line counted today was at its count
// before today, and the difference, biggest drop first. For spotting heavy
// use, waste or theft at a glance on the iPad.

const TZ = "America/Chicago";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function countsLine(counts: CountRef[], sameDay: boolean): string {
  return andList(counts.map((c) => `${sameDay ? clock(c.at) : dayTime(c.at)}${c.byName ? ` (${c.byName})` : ""}`));
}

export default function CountChanges() {
  const api = useOpsApi();
  const [data, setData] = useState<CountComparison | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getCountComparison()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("Couldn't load the comparison. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);

  if (error) return <p style={{ color: "var(--danger-text)" }}>{error}</p>;
  if (data === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (data === null) return <p className="text-lg">No par count yet. Do one from the Par count tab.</p>;

  const down = data.rows.filter((r) => r.diff !== null && r.diff < 0);
  const up = data.rows.filter((r) => r.diff !== null && r.diff > 0);
  const same = data.rows.filter((r) => r.diff === 0);
  const first = data.rows.filter((r) => r.diff === null);

  return (
    <div className="space-y-6">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {data.today ? "Today's" : `Nothing counted yet today. ${dayLabel(data.date)}'s`} count{data.counts.length === 1 ? "" : "s"} at {countsLine(data.counts, true)}, against each item&apos;s count before{" "}
        {data.today ? "today" : "that day"}. Biggest drop first.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tally n={down.length} label="went down" tone="warn" />
        <Tally n={up.length} label="went up" tone="good" />
        <Tally n={same.length} label="no change" />
        <Tally n={first.length} label="first count" />
      </div>

      {down.length > 0 && <Group title="Went down" rows={down} tone="warn" today={data.today} />}
      {up.length > 0 && <Group title="Went up" rows={up} tone="good" today={data.today} />}
      {down.length === 0 && up.length === 0 && same.length > 0 && <p className="text-lg">Nothing went up or down since the count before.</p>}
      {same.length > 0 && <Group title="No change" rows={same} today={data.today} collapsed />}
      {first.length > 0 && (
        <Group title="First count" note="No earlier count to compare with yet." rows={first} today={data.today} collapsed={down.length + up.length + same.length > 0} />
      )}
    </div>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone?: "warn" | "good" }) {
  const color = n && tone === "warn" ? "var(--warn-text)" : n && tone === "good" ? "var(--success-text)" : undefined;
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="font-display text-3xl leading-none tabular-nums" style={{ color }}>
        {n}
      </div>
      <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}

function Group({
  title,
  note,
  rows,
  tone,
  today,
  collapsed,
}: {
  title: string;
  note?: string;
  rows: CountChange[];
  tone?: "warn" | "good";
  today: boolean;
  collapsed?: boolean;
}) {
  const body = (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div
        className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b px-4 py-2 text-xs font-bold uppercase tracking-wide md:grid"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        <span>Item</span>
        <span>Before</span>
        <span>Now</span>
        <span>Change</span>
      </div>
      {rows.map((r, idx) => (
        <Row key={r.itemId} r={r} tone={tone} today={today} first={idx === 0} />
      ))}
    </div>
  );
  if (collapsed) {
    return (
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-lg font-bold">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          {title} ({rows.length})
          {note && (
            <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
              {note}
            </span>
          )}
        </summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return (
    <section>
      <h3 className="mb-2 font-display text-xl">
        {title} <span className="text-base font-normal" style={{ color: "var(--muted)" }}>({rows.length})</span>
      </h3>
      {body}
    </section>
  );
}

function Row({ r, tone, today, first }: { r: CountChange; tone?: "warn" | "good"; today: boolean; first: boolean }) {
  const color = tone === "warn" ? "var(--warn-text)" : tone === "good" ? "var(--success-text)" : undefined;
  return (
    <div
      className={`grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center ${first ? "" : "border-t"}`}
      style={{ borderColor: "var(--border)" }}
    >
      <div className="col-span-2 md:col-span-1">
        <div className="font-bold">{r.name}</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {r.section ? `${r.area} › ${r.section}` : r.area}
          {r.unitSize ? ` · ${r.unitSize}` : ""}
        </div>
      </div>
      <div>
        <span className="text-xs md:hidden" style={{ color: "var(--muted)" }}>
          Before:{" "}
        </span>
        {r.prev ? (
          <>
            <span className="tabular-nums">{qtyUnit(r.prev.qty, r.unit)}</span>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {dayTime(r.prev.at)}
              {r.prev.byName ? ` · ${r.prev.byName}` : ""}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </div>
      <div>
        <span className="text-xs md:hidden" style={{ color: "var(--muted)" }}>
          Now:{" "}
        </span>
        <span className="font-bold tabular-nums">{qtyUnit(r.now.qty, r.unit)}</span>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {today ? clock(r.now.at) : dayTime(r.now.at)}
          {r.now.byName ? ` · ${r.now.byName}` : ""}
        </div>
      </div>
      <div className="col-span-2 md:col-span-1">
        {r.diff === null ? (
          <span style={{ color: "var(--muted)" }}>First count</span>
        ) : (
          <span className="text-lg font-bold" style={{ color }}>
            {changeLabel(r.diff, r.unit)}
          </span>
        )}
      </div>
    </div>
  );
}
