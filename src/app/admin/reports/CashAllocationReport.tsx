"use client";

import { useState, useTransition } from "react";
import type { CashAllocation } from "@/lib/data/reports";
import { getCashAllocation } from "./actions";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function CashAllocationReport({ initialDate, initial }: { initialDate: string; initial: CashAllocation }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initial);
  const [loading, startTransition] = useTransition();

  function changeDate(next: string) {
    setDate(next);
    startTransition(async () => {
      setData(await getCashAllocation(next));
    });
  }

  const foodDrinkTotal = data.categoryRevenue.food + data.categoryRevenue.coffee + data.categoryRevenue.soda + data.categoryRevenue.liquor;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Daily cash allocation</h2>
        <div className="flex items-center gap-2 text-sm">
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => changeDate(todayCentral())}>
            Today
          </button>
          <input type="date" className="rounded border border-[var(--border)] px-2 py-1 text-sm" value={date} onChange={(e) => changeDate(e.target.value)} />
          {loading && <span className="text-xs text-[var(--muted)]">loading…</span>}
        </div>
      </div>
      <p className="mb-4 text-xs text-[var(--muted)]">
        {fmtDate(data.date)}, {data.windowLabel} -- Nathan&apos;s split for moving the day&apos;s sales into the right accounts. Each figure below is
        its own independent rule (not a sequential split of one pot), so they won&apos;t necessarily add up to total sales -- see the note at the
        bottom.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="text-xs text-[var(--muted)]">Tax account</div>
          <div className="text-xl font-semibold">{money(data.taxAccount)}</div>
          <div className="text-[11px] text-[var(--muted)]">10% of total sales ({money(data.totalSales)})</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="text-xs text-[var(--muted)]">Box office account</div>
          <div className="text-xl font-semibold">{money(data.boxOfficeAccount)}</div>
          <div className="text-[11px] text-[var(--muted)]">
            $4 x {data.paidTicketCount} paid ticket{data.paidTicketCount === 1 ? "" : "s"}
            {data.ticketCount !== data.paidTicketCount && ` (+${data.ticketCount - data.paidTicketCount} free/Insiders+, not counted)`}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="text-xs text-[var(--muted)]">Inventory / purchasing</div>
          <div className="text-xl font-semibold">{money(data.inventoryAccount)}</div>
          <div className="text-[11px] text-[var(--muted)]">20% of food/coffee/soda/liquor ({money(foodDrinkTotal)})</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="text-xs text-[var(--muted)]">Expense account</div>
          <div className="text-xl font-semibold">{money(data.expenseAccount)}</div>
          <div className="text-[11px] text-[var(--muted)]">80% of food/coffee/soda/liquor ({money(foodDrinkTotal)})</div>
        </div>
      </div>

      <div className="mt-4 grid gap-x-4 gap-y-1 text-xs text-[var(--muted)] sm:grid-cols-3">
        <div>
          Tickets: <span className="text-[var(--foreground)]">{money(data.ticketRevenue)}</span> ({data.ticketCount} sold)
        </div>
        <div>
          Booth reservations: <span className="text-[var(--foreground)]">{money(data.boothRevenue)}</span>
        </div>
        <div>
          Food: <span className="text-[var(--foreground)]">{money(data.categoryRevenue.food)}</span>
        </div>
        <div>
          Coffee: <span className="text-[var(--foreground)]">{money(data.categoryRevenue.coffee)}</span>
        </div>
        <div>
          Soda/drinks: <span className="text-[var(--foreground)]">{money(data.categoryRevenue.soda)}</span>
        </div>
        <div>
          Liquor: <span className="text-[var(--foreground)]">{money(data.categoryRevenue.liquor)}</span>
        </div>
        {data.categoryRevenue.other > 0 && (
          <div>
            Other (candy, etc.): <span className="text-[var(--foreground)]">{money(data.categoryRevenue.other)}</span>
          </div>
        )}
      </div>

      <div className="notice notice-warn mt-4 !p-2.5 text-xs">
        Not covered by one of the 4 rules above: ticket/booth revenue beyond their own carve-out, and candy or other
        uncategorized items ({money(data.categoryRevenue.other)}) -- those aren&apos;t assigned to an account here.
        The food/drink 20%/80% split was flagged as a &quot;maybe&quot; -- worth confirming with Nathan before relying
        on it.
      </div>
    </section>
  );
}
