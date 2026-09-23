import Link from "next/link";
import { requireMember } from "@/lib/member-auth";
import { getPurchases, yearOf, type PurchaseRow } from "@/lib/data/member-account";
import { dateShort, money } from "../format";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage() {
  const member = await requireMember();
  const purchases = await getPurchases(member.id);
  const byYear = new Map<number, PurchaseRow[]>();
  for (const p of purchases) {
    const y = yearOf(p.date);
    byYear.set(y, [...(byYear.get(y) ?? []), p]);
  }

  if (purchases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-5 py-8 text-sm text-[var(--muted)]">
        <p className="font-bold text-[var(--foreground)]">No purchases on this account yet.</p>
        <p className="mt-1">
          At the register, scan your member card or give staff your name so your order (and its points) lands here. Tickets you buy online while
          signed in show up automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {[...byYear.entries()].map(([year, rows]) => {
        const paid = rows.filter((r) => r.status === "completed");
        return (
          <section key={year}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">{year}</h2>
                <p className="text-sm text-[var(--muted)]">
                  {paid.length} purchase{paid.length === 1 ? "" : "s"} · {money(paid.reduce((s, r) => s + r.amount, 0))}
                </p>
              </div>
              <a href={`/account/statements/${year}`} className="btn-secondary !px-4 !py-2 text-sm">
                Download {year} statement (PDF)
              </a>
            </div>
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {rows.map((p, i) => (
                <Link
                  key={`${p.kind}-${p.id}`}
                  href={`/account/purchases/${p.kind}/${p.id}`}
                  className={`flex items-center gap-4 px-4 py-3 hover:bg-[var(--surface-hover)] ${i ? "border-t border-[var(--border)]" : ""}`}
                >
                  <div className="w-24 shrink-0 text-sm text-[var(--muted)]">{dateShort(p.date)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{p.label}</div>
                    <div className="truncate text-xs text-[var(--muted)]">{p.detail}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-bold tabular-nums ${p.status === "refunded" ? "text-[var(--muted)] line-through" : ""}`}>{money(p.amount)}</div>
                    {p.status === "refunded" && <div className="text-[11px] font-bold uppercase text-[var(--accent)]">Refunded</div>}
                  </div>
                  <span className="text-[var(--muted)]" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
