"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import { useRanOut } from "./ran-out-store";
import { qtyLabel, type OnShift, type OpenOutage, type OutageResolution, type ShoppingList } from "@/lib/ops/shared";

const TZ = "America/Chicago";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });

const NO_STORE = "No store listed";
const OFF_SHEET = "Not on the par sheet";
const storeOrder = (a: string, b: string) => {
  const last = (s: string) => (s === OFF_SHEET ? 2 : s === NO_STORE ? 1 : 0);
  return last(a) - last(b) || a.localeCompare(b);
};

const DONE_TEXT: Record<OutageResolution, string> = { bought: "Bought", found: "Found more", mistake: "False alarm:" };

// What ran out mid-shift, then everything under par on the latest count,
// grouped by where it's bought.
export default function ShoppingListTab({
  me,
  closing,
  onFinishClosing,
  onChanged,
}: {
  me: OnShift | null;
  closing: boolean;
  onFinishClosing: () => void;
  onChanged: () => void;
}) {
  const api = useOpsApi();
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

  if (error) return <p style={{ color: "var(--danger-text)" }}>{error}</p>;
  if (list === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  const total = list?.bySource.reduce((s, g) => s + g.lines.length, 0) ?? 0;
  const outGroups = new Map<string, OpenOutage[]>();
  for (const o of outages ?? []) {
    const store = o.parItemId ? o.source || NO_STORE : OFF_SHEET;
    outGroups.set(store, [...(outGroups.get(store) ?? []), o]);
  }
  const ranOut = outages?.length ?? 0;

  return (
    <div className="space-y-6">
      {closing && (
        <div className="notice notice-success flex flex-wrap items-center justify-between gap-3 !p-4">
          <div>
            <strong>Count saved.</strong> Here&apos;s what needs buying. When you&apos;re done, end your shift.
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
      )}
      <h2 className="font-display text-2xl">Shopping list</h2>

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
                              <strong>
                                Get {qtyLabel(o.parQty)}
                                {o.unit ? ` ${o.unit}` : ""}
                              </strong>{" "}
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
          {list ? `From the count on ${when(list.at)}${list.byName ? ` by ${list.byName}` : ""}. ${total} item${total === 1 ? "" : "s"} under par.` : "No par count yet. Do one from the Par count tab."}
        </p>
      </div>
      {list && total === 0 && <p className="text-lg">Everything is at or above par. Nothing to buy.</p>}
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
              <li key={l.itemId} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5">
                <span>
                  <strong>{l.name}</strong> <span className="text-xs" style={{ color: "var(--muted)" }}>{l.area}</span>
                </span>
                <span className="text-sm">
                  <strong>
                    Get {qtyLabel(l.need)}
                    {l.unit ? ` ${l.unit}` : ""}
                  </strong>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    (have {qtyLabel(l.have)}, par {qtyLabel(l.par)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
