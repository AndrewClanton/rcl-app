import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { compsByOrg, taxIncludedSales } from "@/lib/data/organizations";
import { businessDay } from "@/lib/ops/time";

export const dynamic = "force-dynamic";

// Reports → Organizations (lib/orgs.ts): comps by organization and day for
// a month, and supported guests' even-dollar (tax-included) sales.

const money = (n: number) => `$${n.toFixed(2)}`;

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function day(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function OrgReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireStaff();
  const { month: asked } = await searchParams;
  const today = businessDay().date;
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lastDay = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const to = lastDay < today ? lastDay : today;
  const from = `${month}-01`;
  const [orgs, even] = from <= to ? await Promise.all([compsByOrg(from, to), taxIncludedSales(from, to)]) : [[], { sales: 0, tax: 0, orders: 0 }];
  const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Organizations · {title}</h1>
        <div className="flex gap-2">
          <Link className="btn-secondary" href={`?month=${shift(month, -1)}`}>
            ← Earlier
          </Link>
          <Link className="btn-secondary" href={`?month=${shift(month, 1)}`}>
            Later →
          </Link>
        </div>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">Even-dollar sales (tax included)</h2>
        <p className="text-sm text-[var(--muted)]">Supported guests pay the listed price as the total; the tax is inside it and counted in Sales tax.</p>
        <p className="mt-2 tabular-nums">
          {even.orders} {even.orders === 1 ? "order" : "orders"} · {money(even.sales)} paid · {money(even.sales - even.tax)} sales + {money(even.tax)} tax
        </p>
      </section>

      {orgs.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">No organization comps this month.</p>
      ) : (
        orgs.map((o) => (
          <section key={o.orgId} className="card">
            <h2 className="text-lg font-semibold">
              <Link href={`/admin/organizations/${o.orgId}`} className="hover:underline">
                {o.name}
              </Link>
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {o.people} comps{o.noAccount > 0 ? ` (${o.noAccount} no account)` : ""} · {money(o.value)} at their prices ·{" "}
              <Link href={`/admin/organizations/${o.orgId}/statement?month=${month}`} className="underline">
                statement
              </Link>
            </p>
            <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
              {o.days.map((d) => (
                <li key={d.date} className="flex justify-between py-1.5 tabular-nums">
                  <span>{day(d.date)}</span>
                  <span>
                    {d.people} comped{d.noAccount > 0 ? ` (${d.noAccount} no account)` : ""} · {money(d.value)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
