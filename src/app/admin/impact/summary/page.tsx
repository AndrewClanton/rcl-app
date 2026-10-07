import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getImpact } from "@/lib/data/impact";
import { nonprofitEin } from "@/lib/data/org-invoices";
import { businessDay } from "@/lib/ops/time";
import { ADDRESS, CATEGORY_LABEL, money, NONPROFIT, NONPROFIT_TAGLINE, nonprofitLine, shortDate } from "@/lib/org-invoices";
import { COUNTING_NOTE, ImpactTable, ImpactTiles, monthLabel } from "../ImpactTables";
import { PrintButton } from "../../organizations/InvoiceForms";

export const dynamic = "force-dynamic";

// The Community impact summary for grants and board reports: one clean
// page that prints (the Back office menu and buttons drop off).

export default async function ImpactSummaryPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAdmin();
  const { year: asked } = await searchParams;
  const today = businessDay().date;
  const thisYear = Number(today.slice(0, 4));
  const year = asked && /^\d{4}$/.test(asked) && Number(asked) >= 2026 && Number(asked) <= thisYear ? Number(asked) : thisYear;
  const [r, ein] = await Promise.all([getImpact(year, today), nonprofitEin()]);
  const span = `${shortDate(r.from)} to ${shortDate(r.to)}, ${year}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        back={{ href: `/admin/impact?year=${year}`, label: "Community impact" }}
        eyebrow={NONPROFIT}
        title={`Community impact, ${year}`}
        purpose={`${NONPROFIT_TAGLINE} ${span}.`}
        actions={<PrintButton label="Print or save as PDF" />}
      />

      <p className="text-sm">
        The {NONPROFIT} is a 501(c)(3) nonprofit bringing accessible, affordable, communal film experiences to Joplin: people with disabilities, seniors in
        assisted living and retirement communities, students of all ages, and community screenings in the city&apos;s redeveloping neighborhoods. Screenings and
        events are hosted at Royale Cinema.
      </p>

      <ImpactTiles c={r.ytd} />

      {r.byCategory.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-2 text-lg font-semibold">Who we served</h2>
          <ImpactTable first="Community" rows={r.byCategory.map((c) => ({ key: c.category, label: c.label, cells: c.cells }))} />
        </section>
      )}

      <section className="break-inside-avoid">
        <h2 className="mb-2 text-lg font-semibold">By month</h2>
        <ImpactTable first="Month" rows={r.byMonth.map((m) => ({ key: m.month, label: monthLabel(m.month), cells: m.cells }))} total={r.ytd} />
      </section>

      <section className="break-inside-avoid">
        <h2 className="mb-2 text-lg font-semibold">By partner organization</h2>
        <ImpactTable
          first="Organization"
          rows={r.byOrg.map((o) => ({
            key: o.key,
            label: (
              <>
                {o.name}
                <span className="text-xs text-[var(--muted)]"> · {CATEGORY_LABEL[o.category]}</span>
              </>
            ),
            cells: o.cells,
          }))}
          total={r.ytd}
        />
      </section>

      {r.activities.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-2 text-lg font-semibold">Community activities</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {r.activities.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span className="min-w-0">
                  {shortDate(a.date)} · {a.description}
                  <span className="text-[var(--muted)]"> · {CATEGORY_LABEL[a.category]}</span>
                </span>
                <span className="tabular-nums">
                  {a.people} people · {money(a.value)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="space-y-1 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
        <p>{COUNTING_NOTE}</p>
        <p>
          {nonprofitLine(ein)} · {ADDRESS} · {NONPROFIT_TAGLINE}
        </p>
      </footer>
    </div>
  );
}
