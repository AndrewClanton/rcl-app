import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getOrgStatement } from "@/lib/data/organizations";
import { orgDay } from "@/lib/orgs-server";

export const dynamic = "force-dynamic";

// One organization's month: the fee, and every comp (who, which day, a day
// pass or a movie, and what it would have cost). Prints cleanly.

const UUID = /^[0-9a-f-]{36}$/i;
const money = (n: number) => `$${n.toFixed(2)}`;

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function day(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function OrgStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const [{ id }, { month: asked }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : orgDay().slice(0, 7);
  const s = await getOrgStatement(id, month);
  if (!s) notFound();
  const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-5">
      <PageHeader
        area="guests"
        back={{ href: `/admin/organizations/${id}`, label: s.org.name }}
        title={`${s.org.name}: ${title}`}
        purpose="Royale Cinema Lounge monthly statement"
        actions={
          <div className="flex gap-2 print:hidden">
            <Link className="btn-secondary" href={`?month=${shift(month, -1)}`}>
              ← Earlier
            </Link>
            <Link className="btn-secondary" href={`?month=${shift(month, 1)}`}>
              Later →
            </Link>
          </div>
        }
      />
      <section className="card grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-sm text-[var(--muted)]">Monthly fee</div>
          <div className="text-xl font-semibold tabular-nums">{money(s.org.monthly_fee)}</div>
        </div>
        <div>
          <div className="text-sm text-[var(--muted)]">Comps used</div>
          <div className="text-xl font-semibold tabular-nums">
            {s.comps} on {s.days.length} {s.days.length === 1 ? "day" : "days"}
          </div>
          <div className="text-xs text-[var(--muted)]">Up to {s.org.daily_comp_limit} a day. One comp is one person&apos;s day.</div>
        </div>
        <div>
          <div className="text-sm text-[var(--muted)]">Value of comps</div>
          <div className="text-xl font-semibold tabular-nums">{money(s.value)}</div>
          {s.overLimit > 0 && <div className="text-xs text-[var(--muted)]">{s.overLimit} over the daily limit, approved by a manager.</div>}
        </div>
      </section>
      <section className="card">
        {s.rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No comps this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 font-normal">Guest</th>
                <th className="py-1 font-normal">Comp</th>
                <th className="py-1 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td className="py-1.5">{day(r.date)}</td>
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5">
                    {r.kind === "day_pass" ? "Day pass" : "Movie"}
                    {r.orderNumber ? <span className="text-[var(--muted)]"> · #{r.orderNumber}</span> : null}
                    {r.overLimit ? <span className="text-[var(--muted)]"> · over limit</span> : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
