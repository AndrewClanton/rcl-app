import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getImpact, impactCsv } from "@/lib/data/impact";
import { nonprofitEin } from "@/lib/data/org-invoices";
import { businessDay } from "@/lib/ops/time";
import { CATEGORY_LABEL, money, NONPROFIT_TAGLINE, shortDate } from "@/lib/org-invoices";
import { COUNTING_NOTE, ImpactTable, ImpactTiles, monthLabel } from "./ImpactTables";
import { ActivityForm, CsvButton, EinForm, RemoveActivity } from "./ImpactForms";

export const dynamic = "force-dynamic";

// Back office → Community impact (lib/data/impact.ts): what the Royale
// Cinema Project gives people with disabilities, seniors, students and
// neighborhoods, by organization and month, for grants and board reports.

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAdmin();
  const { year: asked } = await searchParams;
  const today = businessDay().date;
  const thisYear = Number(today.slice(0, 4));
  const year = asked && /^\d{4}$/.test(asked) && Number(asked) >= 2026 && Number(asked) <= thisYear ? Number(asked) : thisYear;
  const [r, ein] = await Promise.all([getImpact(year, today), nonprofitEin()]);

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        title="Community impact"
        purpose={`What the Royale Cinema Project gives: ${NONPROFIT_TAGLINE} ${year === thisYear ? `${year} to date, through ${shortDate(r.to)}` : `All of ${year}`}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {year > 2026 && (
              <Link className="btn-secondary" href={`?year=${year - 1}`}>
                ← {year - 1}
              </Link>
            )}
            {year < thisYear && (
              <Link className="btn-secondary" href={`?year=${year + 1}`}>
                {year + 1} →
              </Link>
            )}
            <Link className="btn-primary" href={`/admin/impact/summary?year=${year}`}>
              Printable summary
            </Link>
            <CsvButton rows={impactCsv(r)} name={`community-impact-${year}.csv`} />
          </div>
        }
      />

      <ImpactTiles c={r.ytd} />

      {r.byCategory.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg font-semibold">Who we served</h2>
          <ImpactTable first="Community" rows={r.byCategory.map((c) => ({ key: c.category, label: c.label, cells: c.cells }))} />
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 text-lg font-semibold">By month</h2>
        <ImpactTable first="Month" rows={r.byMonth.map((m) => ({ key: m.month, label: monthLabel(m.month), cells: m.cells }))} total={r.ytd} />
      </section>

      <section className="card">
        <h2 className="mb-2 text-lg font-semibold">By organization, year to date</h2>
        <ImpactTable
          first="Organization"
          rows={r.byOrg.map((o) => ({
            key: o.key,
            label: (
              <>
                {o.key.startsWith("activities:") ? o.name : <Link href={`/admin/organizations/${o.key}`}>{o.name}</Link>}
                <span className="text-xs text-[var(--muted)]"> · {CATEGORY_LABEL[o.category]}</span>
              </>
            ),
            cells: o.cells,
          }))}
          total={r.ytd}
        />
        <p className="mt-2 text-xs text-[var(--muted)]">
          Discounted events are added on each organization&apos;s invoice (Organizations → the organization → Monthly invoice).
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Log a community activity</h2>
        <p className="text-sm text-[var(--muted)]">
          Something that isn&apos;t an organization comp or invoice line: a free screening for assisted living residents, a school field trip, a neighborhood movie
          night. It counts toward people served and value covered.
        </p>
        <ActivityForm orgs={r.orgs} today={today} />
        {r.activities.length > 0 && (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {r.activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="min-w-0">
                  {shortDate(a.date)} · {a.description}
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {CATEGORY_LABEL[a.category]}
                    {a.orgName ? ` · ${a.orgName}` : ""}
                    {a.addedBy ? ` · logged by ${a.addedBy}` : ""}
                  </span>
                </span>
                <span className="flex items-baseline gap-3 tabular-nums">
                  {a.people} people · {money(a.value)}
                  <RemoveActivity id={a.id} label={a.description} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">Nonprofit details</h2>
        <p className="text-sm text-[var(--muted)]">
          The EIN of Royale Cinema Project Co (the legal name). It shows on invoices and the printable summary.
        </p>
        <EinForm initial={ein ?? ""} />
      </section>

      <p className="text-xs text-[var(--muted)]">{COUNTING_NOTE}</p>
    </div>
  );
}
