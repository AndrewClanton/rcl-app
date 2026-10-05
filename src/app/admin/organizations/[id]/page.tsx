import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getOrganization } from "@/lib/data/organizations";
import { compCountText, STATUS_LABEL } from "@/lib/orgs";
import { orgBilling } from "@/lib/org-billing";
import { siteOrigin } from "@/lib/site-origin";
import { ORG_INVITES_PER_HOUR, recentOrgInvites } from "@/lib/org-invite-server";
import { withArticle } from "@/lib/email/org-invite-email";
import { AddPerson, AttachPerson, BillingButtons, EmailInvite, InviteLink, OrgEditor, PersonRow } from "../OrgForms";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

function day(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function sentAt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

const money =(n: number) => `$${n.toFixed(2)}`;

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await getOrganization(id);
  if (!detail) notFound();
  const { org, people, labelled, today, month } = detail;
  const [billing, origin, invites] = await Promise.all([orgBilling(org), siteOrigin(), recentOrgInvites(org.id)]);
  const helpers = people.filter((p) => p.role === "helper");
  const guests = people.filter((p) => p.role === "supported");
  const thisMonth = today.date.slice(0, 7);

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        back={{ href: "/admin/organizations", label: "Organizations" }}
        title={org.name}
        purpose={`${STATUS_LABEL[org.status]} · $${org.monthly_fee.toFixed(2)} a month · ${org.daily_comp_limit} comps a day`}
        actions={
          <Link href={`/admin/organizations/${org.id}/statement?month=${thisMonth}`} className="btn-secondary">
            Monthly statement
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <div className="text-sm text-[var(--muted)]">Comps today</div>
          <div className="text-2xl font-semibold tabular-nums">{compCountText(today.used, org.daily_comp_limit)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-[var(--muted)]">This month</div>
          <div className="text-2xl font-semibold tabular-nums">
            {month.comps} comps · {money(month.value)}
          </div>
          <div className="text-xs text-[var(--muted)]">What the day passes and tickets would have cost.</div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">People</h2>
        {[
          { title: "Supported guests", hint: "Comps, and prices with the tax included so totals are even dollars.", list: guests },
          { title: "Helpers / staff", hint: "Comps; normal prices plus tax on purchases.", list: helpers },
        ].map((g) => (
          <div key={g.title}>
            <h3 className="font-semibold">
              {g.title} · {g.list.length}
            </h3>
            <p className="text-xs text-[var(--muted)]">{g.hint}</p>
            {g.list.length > 0 && (
              <ul className="divide-y divide-[var(--border)]">
                {g.list.map((p) => (
                  <PersonRow key={p.id} orgId={org.id} person={p} />
                ))}
              </ul>
            )}
          </div>
        ))}
        {labelled.length > 0 && (
          <div>
            <h3 className="font-semibold">Tagged &quot;{org.name}&quot; but not attached</h3>
            <ul className="mt-1 space-y-1">
              {labelled.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">{p.name}</span>
                  <AttachPerson orgId={org.id} id={p.id} name={p.name} />
                  <AttachPerson orgId={org.id} id={p.id} name={p.name} role="helper" />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h3 className="mb-1 font-semibold">Add someone</h3>
          <AddPerson orgId={org.id} />
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">Helper sign-up link</h2>
        <p className="text-sm text-[var(--muted)]">
          Send this to the organization. A helper opens it and signs up (or signs in) with their <strong>work</strong> email; that login joins{" "}
          {org.name} as a helper, separate from any personal Royale account.
        </p>
        <InviteLink orgId={org.id} url={`${origin}/account/join?c=${org.invite_code}`} />
        {org.status !== "closed" && <EmailInvite orgId={org.id} orgName={org.name} />}
        <p className="text-xs text-[var(--muted)]">
          The email comes from the Royale, signed &quot;The Royale crew&quot;, with one big &quot;Join as {withArticle(org.name)} helper&quot; button. Up to {ORG_INVITES_PER_HOUR} an
          hour. At the register, &quot;Organization guests&quot; → Invite a helper lets a helper type their own work email.
        </p>
        {invites.length > 0 && (
          <div>
            <h3 className="font-semibold">Emailed</h3>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {invites.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                  <span className="min-w-0 break-all">{s.email}</span>
                  <span className="text-[var(--muted)]">
                    {sentAt(s.at)} · {s.sentByName ?? "staff"} · {s.source === "register" ? "at the register" : "Back office"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">Billing</h2>
        {billing.mode === "hand" ? (
          <p className="text-sm">Billing: invoiced by hand. (Set STRIPE_PRICE_ORG_MONTHLY to bill through Stripe.)</p>
        ) : billing.mode === "error" ? (
          <p className="notice notice-warn text-sm">Couldn&apos;t read the Stripe subscription: {billing.error}</p>
        ) : billing.mode === "on" ? (
          <p className="text-sm">
            Stripe subscription: <strong>{billing.status}</strong>
            {billing.amount != null && ` · $${billing.amount.toFixed(2)} a month`}
            {billing.nextAt && ` · next invoice ${new Date(billing.nextAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}`}. Stripe
            emails each invoice to {org.contact_email ?? "the contact"}.
          </p>
        ) : (
          <p className="text-sm">Not billed through Stripe yet. Starting it emails a monthly invoice to {org.contact_email ?? "the contact email (add one first)"}.</p>
        )}
        {billing.mode !== "hand" && <BillingButtons orgId={org.id} on={!!org.stripe_subscription_id} />}
      </section>

      {month.days.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg font-semibold">Comps this month</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {month.days.map((d) => (
              <li key={d.date} className="flex justify-between py-1.5 tabular-nums">
                <span>{day(d.date)}</span>
                <span>
                  {compCountText(d.people, org.daily_comp_limit)} · {money(d.value)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <OrgEditor
          id={org.id}
          initial={{
            name: org.name,
            contactName: org.contact_name ?? "",
            contactEmail: org.contact_email ?? "",
            monthlyFee: org.monthly_fee,
            dailyCompLimit: org.daily_comp_limit,
            status: org.status,
            notes: org.notes ?? "",
          }}
        />
      </section>
    </div>
  );
}
