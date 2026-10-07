import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getOrgInvoice } from "@/lib/data/org-invoices";
import { orgDay } from "@/lib/orgs-server";
import {
  ADDRESS,
  BUSINESS,
  isReceipt,
  money,
  MONTH,
  monthRange,
  monthTitle,
  NONPROFIT,
  NONPROFIT_TAGLINE,
  nonprofitLine,
  shiftMonth,
  shortDate,
  statusText,
} from "@/lib/org-invoices";
import { AddInvoiceLine, FeeToggle, InvoiceStatus, PayLink, PrintButton, RemoveLine, SendInvoice } from "../../InvoiceForms";

export const dynamic = "force-dynamic";

// One organization's monthly invoice/receipt (lib/org-invoices.ts): the
// document (prints cleanly, the staff controls drop off), then payment
// status, the pay-by-card link, emailing it, and adding lines.

const UUID = /^[0-9a-f-]{36}$/i;

function sentAt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

export default async function OrgInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const [{ id }, { month: asked }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const today = orgDay();
  const month = asked && MONTH.test(asked) ? asked : today.slice(0, 7);
  const inv = await getOrgInvoice(id, month);
  if (!inv) notFound();
  const { org, doc } = inv;
  const t = doc.totals;
  const receipt = isReceipt(doc);
  const { from, to } = monthRange(month);
  const lineIds = new Map(inv.lines.map((l, i) => [i, l]));

  return (
    <div className="space-y-5">
      <PageHeader
        area="guests"
        back={{ href: `/admin/organizations/${id}`, label: org.name }}
        title={`${org.name}: ${monthTitle(month)} ${receipt ? "receipt" : "invoice"}`}
        purpose="Each line: what it was worth, what they were charged, and what the Royale Cinema Project covered."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link className="btn-secondary" href={`?month=${shiftMonth(month, -1)}`}>
              ← Earlier
            </Link>
            <Link className="btn-secondary" href={`?month=${shiftMonth(month, 1)}`}>
              Later →
            </Link>
            <PrintButton />
          </div>
        }
      />

      <section className="card space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Royale Cinema Lounge</div>
            <div className="text-xl font-semibold">
              {doc.orgName}
              {doc.contactName ? <span className="text-base font-normal text-[var(--muted)]"> · {doc.contactName}</span> : null}
            </div>
          </div>
          <div className="text-right text-sm text-[var(--muted)]">
            {receipt ? "Receipt" : "Invoice"} {doc.number}
            <br />
            {monthTitle(month)}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Worth", value: t.fullValue },
            { label: "They pay", value: t.charged },
            { label: "Covered", value: t.covered },
          ].map((x, i) => (
            <div key={x.label} className={`rounded-lg border-2 border-[var(--foreground)] p-2 ${i === 2 ? "bg-[var(--gold)] text-[var(--gold-foreground)]" : ""}`}>
              <div className="text-xs uppercase tracking-wider">{x.label}</div>
              <div className="text-lg font-bold tabular-nums sm:text-2xl">{money(x.value)}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-sm">
          Covered by the <strong>{NONPROFIT}</strong>, a 501(c)(3) nonprofit: <em>{NONPROFIT_TAGLINE}</em>
        </p>
        <p className="text-center text-lg font-semibold">{statusText(doc)}</p>

        {doc.lines.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing on this month yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)]">
                  <th className="py-1 font-normal">Date</th>
                  <th className="py-1 font-normal">What</th>
                  <th className="py-1 text-right font-normal">Worth</th>
                  <th className="py-1 text-right font-normal">Charged</th>
                  <th className="py-1 text-right font-normal">Covered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {doc.lines.map((l, i) => {
                  const own = lineIds.get(i);
                  return (
                    <tr key={i}>
                      <td className="py-1.5 align-top whitespace-nowrap">{l.date ? shortDate(l.date) : "Month"}</td>
                      <td className="py-1.5 align-top">
                        {l.label}
                        {l.detail ? <span className="text-[var(--muted)]"> · {l.detail}</span> : null}
                        {own ? (
                          <span className="ml-2">
                            <RemoveLine orgId={id} lineId={own.id} label={own.description} />
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right align-top tabular-nums">{money(l.fullValue)}</td>
                      <td className="py-1.5 text-right align-top tabular-nums">{money(l.charged)}</td>
                      <td className="py-1.5 text-right align-top font-semibold tabular-nums">{money(l.covered)}</td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td className="py-2" colSpan={2}>
                    Month total
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(t.fullValue)}</td>
                  <td className="py-2 text-right tabular-nums">{money(t.charged)}</td>
                  <td className="py-2 text-right tabular-nums">{money(t.covered)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-[var(--muted)]">
          Comps are day passes and movies at their menu price. {BUSINESS} · {ADDRESS}. {nonprofitLine(doc.ein)}.
          Thank you! The RCL crew
        </p>
      </section>

      {inv.compDays.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg font-semibold">Comps by day</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {inv.compDays.map((d) => (
              <li key={d.date} className="flex justify-between gap-3 py-1.5 tabular-nums">
                <span>{shortDate(d.date)}</span>
                <span>
                  {d.visits} {d.visits === 1 ? "visit" : "visits"} · {d.movies} {d.movies === 1 ? "movie" : "movies"} · {money(d.value)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Every comp, by person: <Link href={`/admin/organizations/${id}/statement?month=${month}`}>the monthly statement</Link>.
          </p>
        </section>
      )}

      <section className="card space-y-3 print:hidden">
        <h2 className="text-lg font-semibold">Payment</h2>
        <InvoiceStatus orgId={id} month={month} status={doc.status} method={doc.paidMethod} />
        {inv.invoice?.status_by_name && (
          <p className="text-xs text-[var(--muted)]">
            Last changed by {inv.invoice.status_by_name}, {sentAt(inv.invoice.updated_at)}.
          </p>
        )}
        {org.monthly_fee > 0 && (
          <div>
            <FeeToggle orgId={id} month={month} include={inv.includeFee} fee={org.monthly_fee} />
            <p className="text-xs text-[var(--muted)]">
              {org.stripe_subscription_id ? "Stripe bills this organization's fee, so it's off by default." : "The fee is invoiced by hand, so it's on by default."}
            </p>
          </div>
        )}
        {doc.status === "unpaid" && t.due > 0 && (
          <div>
            <h3 className="font-semibold">Pay by card</h3>
            <p className="mb-1 text-xs text-[var(--muted)]">
              A Stripe link for the amount due, made only when you press the button. It goes in the email, and the invoice turns paid by card when they pay.
            </p>
            <PayLink orgId={id} month={month} url={inv.invoice?.pay_link_url ?? null} current={inv.payLinkCurrent} due={t.due} />
          </div>
        )}
      </section>

      <section className="card space-y-3 print:hidden">
        <h2 className="text-lg font-semibold">Email it</h2>
        <SendInvoice orgId={id} month={month} contactEmail={org.contact_email} receipt={receipt} />
        <p className="text-xs text-[var(--muted)]">From Royale Cinema, signed &quot;The RCL crew&quot;. The same lines and totals as above.</p>
        {inv.sends.length > 0 && (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {inv.sends.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span className="min-w-0 break-all">
                  {s.kind === "receipt" ? "Receipt" : "Invoice"} to {s.email}
                </span>
                <span className="text-[var(--muted)]">
                  {sentAt(s.at)} · {s.sentByName ?? "staff"} · due {money(s.amountDue)}, covered {money(s.covered)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2 print:hidden">
        <h2 className="text-lg font-semibold">Add an event, rental or service</h2>
        <AddInvoiceLine orgId={id} defaultDate={today >= from && today <= to ? today : from} />
      </section>
    </div>
  );
}
