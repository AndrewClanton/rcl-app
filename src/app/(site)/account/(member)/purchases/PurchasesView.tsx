import { yearOf, type PurchaseRow } from "@/lib/data/member-account";
import { money } from "../format";
import { Empty, PurchaseRows, STACK, TAP } from "../ui";

export default function PurchasesView({ purchases }: { purchases: PurchaseRow[] }) {
  const byYear = new Map<number, PurchaseRow[]>();
  for (const p of purchases) {
    const y = yearOf(p.date);
    byYear.set(y, [...(byYear.get(y) ?? []), p]);
  }

  if (purchases.length === 0) {
    return (
      <Empty>
        <p className="font-display text-lg text-[var(--foreground)]">No purchases on this account yet.</p>
        <p className="mt-1">
          At the register, scan your member card or give staff your name so your order (and its points) lands here. Tickets you buy online while signed
          in show up automatically.
        </p>
      </Empty>
    );
  }

  return (
    <div className={STACK}>
      {[...byYear.entries()].map(([year, rows]) => {
        const paid = rows.filter((r) => r.status === "completed");
        return (
          <section key={year} className="sheet overflow-hidden">
            <h2 className="spec-head flex-wrap gap-y-1">
              <span>{year}</span>
              <span>
                {paid.length} purchase{paid.length === 1 ? "" : "s"} · {money(paid.reduce((s, r) => s + r.amount, 0))}
              </span>
            </h2>
            <PurchaseRows rows={rows} />
            {rows.some((r) => r.kind !== "old_register") && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-[var(--border)] px-4 py-3">
              <span className="text-sm text-[var(--muted)]">Every purchase, the tax you paid and your points for {year}, in one PDF.</span>
              <a href={`/account/statements/${year}`} className={`btn-secondary ${TAP} w-full px-4 py-2 text-sm sm:w-auto`}>
                {year} statement (PDF)
              </a>
            </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
