import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { labelsWithoutOrg, listOrganizations } from "@/lib/data/organizations";
import { compCountText, DEFAULT_DAILY_COMP_LIMIT, DEFAULT_MONTHLY_FEE, STATUS_LABEL } from "@/lib/orgs";
import { orgPriceId } from "@/lib/org-billing";
import { LabelToOrg, OrgEditor } from "./OrgForms";

export const dynamic = "force-dynamic";

// Back office → Organizations (lib/orgs.ts): groups like Easter Seals that
// pay a monthly fee for daily comps. Owners and admins.
export default async function OrganizationsPage() {
  await requireAdmin();
  const [orgs, labels] = await Promise.all([listOrganizations(), labelsWithoutOrg()]);
  const billing = orgPriceId() ? "Monthly billing through Stripe is set up." : "Billing: invoiced by hand (STRIPE_PRICE_ORG_MONTHLY isn't set).";
  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        title="Organizations"
        purpose="Groups that bring guests with disabilities and their helpers. Each pays a monthly fee for comps each day: a day pass (and that day's movies) for one person per comp."
      />
      <p className="text-sm text-[var(--muted)]">{billing}</p>

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Organizations</h2>
        {orgs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">None yet. Make one below, or from a label people are tagged with.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/organizations/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 hover:underline">
                  <strong className="min-w-0 flex-1">{o.name}</strong>
                  <span className="text-sm text-[var(--muted)]">
                    {STATUS_LABEL[o.status]} · {o.people} {o.people === 1 ? "person" : "people"} · comps today {compCountText(o.compsToday, o.daily_comp_limit)} · $
                    {o.monthly_fee.toFixed(0)}/mo
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {labels.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-semibold">Tagged at the register</h2>
          <p className="mb-2 text-sm text-[var(--muted)]">
            People with a &quot;Group / organization&quot; label who aren&apos;t in an organization account yet. They&apos;re attached as supported
            guests; switch any helper after.
          </p>
          <div className="divide-y divide-[var(--border)]">
            {labels.map((l) => (
              <LabelToOrg key={l.label} label={l.label} people={l.people} exists={l.exists} />
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">New organization</h2>
        <OrgEditor
          id={null}
          initial={{ name: "", contactName: "", contactEmail: "", monthlyFee: DEFAULT_MONTHLY_FEE, dailyCompLimit: DEFAULT_DAILY_COMP_LIMIT, status: "active", notes: "", impactCategory: "disabilities" }}
        />
      </section>
    </div>
  );
}
