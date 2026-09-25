"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import { qtyLabel, type ShoppingList } from "@/lib/ops/shared";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

// Everything under par on the latest count, grouped by where it's bought.
export default function ShoppingListTab({ closing, onFinishClosing }: { closing: boolean; onFinishClosing: () => void }) {
  const api = useOpsApi();
  const [list, setList] = useState<ShoppingList | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getShoppingList()
      .then((l) => alive && setList(l))
      .catch(() => alive && setError("Couldn't load the shopping list. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);

  if (error) return <p style={{ color: "var(--danger-text)" }}>{error}</p>;
  if (list === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  const total = list?.bySource.reduce((s, g) => s + g.lines.length, 0) ?? 0;

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
      <div>
        <h2 className="font-display text-2xl">Shopping list</h2>
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
