"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import { useRanOut } from "./ran-out-store";
import CountChanges, { countsLine } from "./CountChanges";
import { buyQty, qtyLabel, qtyUnit, type OnShift, type OpenOutage, type OutageResolution, type ShoppingList } from "@/lib/ops/shared";

const TZ = "America/Chicago";
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });

// Where the under-par numbers came from: "From today's counts at 9:11 PM
// (Andrew) and 9:22 PM (Andrew)."
function sourceLine(list: ShoppingList): string {
  const n = list.counts.length;
  if (list.today) return `From today's count${n === 1 ? "" : "s"} at ${countsLine(list.counts, true)}.`;
  if (n <= 3) return `Nothing counted yet today. From each item's latest count: ${countsLine(list.counts, false)}.`;
  return `Nothing counted yet today. From each item's latest count, across ${n} counts (the latest ${countsLine(list.counts.slice(-1), false)}).`;
}

const NO_STORE = "No store listed";
const OFF_SHEET = "Not on the par sheet";
const storeOrder = (a: string, b: string) => {
  const last = (s: string) => (s === OFF_SHEET ? 2 : s === NO_STORE ? 1 : 0);
  return last(a) - last(b) || a.localeCompare(b);
};

const DONE_TEXT: Record<OutageResolution, string> = { bought: "Bought", found: "Found more", mistake: "False alarm:" };

// What ran out mid-shift, then everything under par across today's counts,
// grouped by where it's bought. "Since the last count" compares today's
// counts with the ones before (shown first right after a count is saved).
export default function ShoppingListTab({
  me,
  closing,
  justCounted = false,
  onFinishClosing,
  onChanged,
}: {
  me: OnShift | null;
  closing: boolean;
  justCounted?: boolean;
  onFinishClosing: () => void;
  onChanged: () => void;
}) {
  const api = useOpsApi();
  const [view, setView] = useState<"buy" | "changes">(justCounted ? "changes" : "buy");
  const [list, setList] = useState<ShoppingList | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [outages, setOutages] = useState<OpenOutage[] | null>(null);
  const [outError, setOutError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Who's marking it: the register's cashier, else whoever's using this iPad.
  const { cashierId } = useRanOut();
  const actingId = cashierId ?? me?.employeeId ?? null;

  useEffect(() => {
    let alive = true;
    api.getShoppingList()
      .then((l) => alive && setList(l))
      .catch(() => alive && setError("Couldn't load the shopping list. Check the connection."));
    api.getOpenOutages()
      .then((o) => alive && setOutages(o))
      .catch(() => alive && setOutError("Couldn't load what ran out. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);

  async function resolve(o: OpenOutage, resolution: OutageResolution) {
    setBusyId(o.id);
    setOutError(null);
    const r = await api.resolveOutage(o.id, resolution, actingId).catch(() => null);
    setBusyId(null);
    if (!r || !r.ok) return setOutError(r && !r.ok ? r.error : `"${o.name}" didn't save. Check the connection and tap it again.`);
    setOutages((prev) => prev?.filter((x) => x.id !== o.id) ?? prev);
    setDone(`${DONE_TEXT[resolution]} ${o.name}.${r.back.length ? ` Back on sale: ${r.back.join(", ")}.` : ""}`);
    onChanged();
  }

  const total = list?.bySource.reduce((s, g) => s + g.lines.length, 0) ?? 0;
  const outGroups = new Map<string, OpenOutage[]>();
  for (const o of outages ?? []) {
    const store = o.parItemId ? o.source || NO_STORE : OFF_SHEET;
    outGroups.set(store, [...(outGroups.get(store) ?? []), o]);
  }
  const ranOut = outages?.length ?? 0;
  const loaded = list !== undefined && outages !== null;

  const top = (
    <>
      {closing ? (
        <div className="notice notice-success flex flex-wrap items-center justify-between gap-3 !p-4">
          <div>
            <strong>Count saved.</strong>{" "}
            {view === "changes" ? "Here's what changed since the last count. Check What to buy too, then end your shift." : "Here's what needs buying. When you're done, end your shift."}
          </div>
          <button
            className="btn-primary !py-3"
            disabled={ending}
            onClick={() => {
              setEnding(true);
              onFinishClosing();
            }}
          >
            {ending ? "Ending…" : "End shift"}
          </button>
        </div>
      ) : (
        justCounted && (
          <div className="notice notice-success !p-3 text-sm" role="status">
            <strong>Count saved.</strong> It&apos;s merged with anything else counted today.
          </div>
        )
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">{view === "buy" ? "Shopping list" : "Since the last count"}</h2>
        <div className="flex overflow-hidden rounded-xl border-2" style={{ borderColor: "var(--foreground)" }} role="tablist" aria-label="Shopping list views">
          {(
            [
              ["buy", `What to buy${loaded ? ` (${total + ranOut})` : ""}`],
              ["changes", "Since the last count"],
            ] as const
          ).map(([v, label], n) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`min-h-12 px-4 text-sm font-bold ${n ? "border-l-2" : ""}`}
              style={{ borderColor: "var(--foreground)", background: view === v ? "var(--foreground)" : "var(--surface)", color: view === v ? "var(--background)" : undefined }}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  if (view === "changes") {
    return (
      <div className="space-y-6">
        {top}
        <CountChanges />
      </div>
    );
  }
  if (error || list === undefined) {
    return (
      <div className="space-y-6">
        {top}
        <p style={{ color: error ? "var(--danger-text)" : "var(--muted)" }}>{error ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {top}

      {(ranOut > 0 || done || outError) && (
        <section className="rounded-xl border-2 p-4" style={{ borderColor: "var(--accent)", background: "var(--surface)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-xl" style={{ color: "var(--accent)" }}>
              Ran out
            </h3>
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {ranOut ? `${ranOut} reported during a shift. Get these first.` : "Nothing else is out."}
            </span>
          </div>
          {done && (
            <div className="notice notice-success mt-3 flex items-center gap-3 !px-3 !py-2 text-sm" role="status">
              <span className="flex-1">{done}</span>
              <button className="px-2 font-bold underline" onClick={() => setDone(null)}>
                OK
              </button>
            </div>
          )}
          {outError && (
            <p className="mt-3 text-sm font-bold" style={{ color: "var(--danger-text)" }}>
              {outError}
            </p>
          )}
          {[...outGroups.entries()]
            .sort((a, b) => storeOrder(a[0], b[0]))
            .map(([store, items]) => (
              <div key={store} className="mt-4">
                <div className="mb-1 flex items-baseline justify-between gap-3 border-b-2 pb-1" style={{ borderColor: "var(--foreground)" }}>
                  <h4 className="font-display text-lg">{store}</h4>
                  <span className="text-sm" style={{ color: "var(--muted)" }}>
                    {items.length} item{items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {items.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                      <div className="min-w-[12rem] flex-1">
                        <div>
                          <strong>{o.name}</strong>{" "}
                          {o.area && (
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              {o.area}
                            </span>
                          )}
                        </div>
                        <div className="text-sm">
                          {o.parQty !== null ? (
                            <>
                              <strong>Get {qtyUnit(Math.max(1, buyQty(o.parQty)), o.unit)}</strong>{" "}
                              <span style={{ color: "var(--muted)" }}>(out, par {qtyLabel(o.parQty)})</span>
                            </>
                          ) : (
                            <strong>Out{o.unit ? ` · ${o.unit}` : ""}</strong>
                          )}
                        </div>
                        <div className="text-xs" style={{ color: "var(--muted)" }}>
                          Reported {dayTime(o.reportedAt)}
                          {o.byName ? ` by ${o.byName}` : ""}
                          {o.note ? ` · “${o.note}”` : ""}
                        </div>
                        {o.stopped.length > 0 && (
                          <div className="text-xs font-bold" style={{ color: "var(--danger-text)" }}>
                            Not selling: {o.stopped.join(", ")}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="btn-secondary min-h-11 !px-3 !py-2 text-sm" disabled={busyId === o.id} onClick={() => resolve(o, "mistake")}>
                          False alarm
                        </button>
                        <button className="btn-secondary min-h-11 !px-3 !py-2 text-sm" disabled={busyId === o.id} onClick={() => resolve(o, "found")}>
                          Found some
                        </button>
                        <button className="btn-primary min-h-11 !px-5 !py-2" disabled={busyId === o.id} onClick={() => resolve(o, "bought")}>
                          {busyId === o.id ? "Saving…" : "Bought it"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      <div>
        {ranOut > 0 && <h3 className="font-display text-xl">Under par</h3>}
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {list ? `${sourceLine(list)} ${total} item${total === 1 ? "" : "s"} under par.` : "No par count yet. Do one from the Par count tab."}
        </p>
      </div>
      {list && total === 0 && <p className="text-lg">Everything counted is at or above par. Nothing to buy.</p>}
      {list?.bySource.map((g) => (
        <section key={g.source}>
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b-2 pb-1" style={{ borderColor: "var(--foreground)" }}>
            <h3 className="font-display text-xl">{g.source}</h3>
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {g.lines.length} item{g.lines.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {g.lines.map((l) => (
              <li key={l.itemId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <span>
                  <strong>{l.name}</strong> <span className="text-xs" style={{ color: "var(--muted)" }}>{l.area}</span>
                </span>
                <span className="text-sm">
                  <strong>Get {qtyUnit(l.buy, l.unit)}</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({l.unitSize ? `${l.unitSize} · ` : ""}have {qtyLabel(l.have)}, par {qtyLabel(l.par)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {list && list.notCounted.length > 0 && <NotCounted list={list} />}
    </div>
  );
}

// Par lines with no count in the set the list came from, so nothing drops
// off the list without anyone noticing.
function NotCounted({ list }: { list: ShoppingList }) {
  const byArea = new Map<string, ShoppingList["notCounted"]>();
  for (const i of list.notCounted) byArea.set(i.area, [...(byArea.get(i.area) ?? []), i]);
  return (
    <details className="group rounded-xl border px-4 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-bold">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        {list.today ? "Not counted today" : "Never counted"} ({list.notCounted.length})
        <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
          {list.today ? "Left off the list above. Count them to see if any are low." : "Left off the list above until they're counted."}
        </span>
      </summary>
      <div className="space-y-3 pb-2 pt-1">
        {[...byArea.entries()].map(([area, items]) => (
          <div key={area}>
            <div className="eyebrow mb-1">{area}</div>
            <ul className="text-sm">
              {items.map((i) => (
                <li key={i.itemId} className="py-0.5">
                  {i.name}
                  {i.section ? <span style={{ color: "var(--muted)" }}> · {i.section}</span> : null}
                  {list.today && <span style={{ color: "var(--muted)" }}> · {i.lastAt ? `last counted ${shortDay(i.lastAt)}` : "never counted"}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
