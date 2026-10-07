import type { ImpactCells } from "@/lib/data/impact";
import { money, monthTitle } from "@/lib/org-invoices";

// The Community impact numbers, shared by the tab and its printable
// summary (lib/data/impact.ts).

const n = (x: number) => x.toLocaleString("en-US");

export function ImpactTiles({ c }: { c: ImpactCells }) {
  const tiles = [
    { label: "People served", value: n(c.peopleServed), sub: `${n(c.supported)} supported guests · ${n(c.helpers)} helpers` },
    { label: "Visits", value: n(c.visits), sub: `${n(c.noAccountVisits)} with no account` },
    { label: "Movies watched", value: n(c.movies), sub: "on comps" },
    { label: "Comps given", value: n(c.comps), sub: `worth ${money(c.compValue)}` },
    { label: "Discounted events", value: n(c.events), sub: `${money(c.eventCovered)} covered of ${money(c.eventValue)}` },
    { label: "Community activities", value: n(c.activities), sub: `${n(c.activityPeople)} people · ${money(c.activityValue)}` },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-[var(--foreground)] bg-[var(--gold)] p-4 text-center text-[var(--gold-foreground)]">
        <div className="text-xs font-bold uppercase tracking-widest">Covered by the Royale Cinema Project</div>
        <div className="text-3xl font-bold tabular-nums">{money(c.covered)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="card !p-3">
            <div className="text-xs text-[var(--muted)]">{t.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-[var(--muted)]">{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const COLS: { label: string; get: (c: ImpactCells) => string }[] = [
  { label: "People", get: (c) => n(c.peopleServed) },
  { label: "Visits", get: (c) => n(c.visits) },
  { label: "Movies", get: (c) => n(c.movies) },
  { label: "Comps", get: (c) => `${n(c.comps)} · ${money(c.compValue)}` },
  { label: "Events covered", get: (c) => (c.events ? `${n(c.events)} · ${money(c.eventCovered)}` : "–") },
  { label: "Activities", get: (c) => (c.activities ? `${n(c.activities)} · ${money(c.activityValue)}` : "–") },
  { label: "Total covered", get: (c) => money(c.covered) },
];

export function ImpactTable({ rows, first, total }: { rows: { key: string; label: React.ReactNode; cells: ImpactCells }[]; first: string; total?: ImpactCells }) {
  if (!rows.length) return <p className="text-sm text-[var(--muted)]">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--muted)]">
            <th className="py-1 pr-2 font-normal">{first}</th>
            {COLS.map((c) => (
              <th key={c.label} className="py-1 pl-2 text-right font-normal whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-1.5 pr-2">{r.label}</td>
              {COLS.map((c) => (
                <td key={c.label} className="py-1.5 pl-2 text-right tabular-nums whitespace-nowrap">
                  {c.get(r.cells)}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr className="font-semibold">
              <td className="py-2 pr-2">Year to date</td>
              {COLS.map((c) => (
                <td key={c.label} className="py-2 pl-2 text-right tabular-nums whitespace-nowrap">
                  {c.get(total)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const monthLabel = (m: string) => monthTitle(m).replace(/ \d{4}$/, "");

export const COUNTING_NOTE =
  "People served: each named guest or helper counts once; a guest with no account counts once per visit; plus the people at discounted events and community activities. A visit is one person's day. Comps are day passes and movies at menu price. Voided and refunded orders don't count.";
