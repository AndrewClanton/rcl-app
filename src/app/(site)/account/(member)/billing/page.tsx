import Link from "next/link";
import { requireMember } from "@/lib/member-auth";
import { activityYears, getPurchases } from "@/lib/data/member-account";
import { getMembershipBilling } from "@/lib/data/member-billing";
import { RATE_LABEL, RATE_PRICE } from "@/lib/membership-rates";
import BillingPortalButton from "../../BillingPortalButton";
import { dateShort, money } from "../format";

export const metadata = { title: "Billing" };

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Active",
  past_due: "Payment failed. Update your card to keep Insiders+",
  unpaid: "Unpaid",
  canceled: "Canceled",
  incomplete: "Waiting on payment",
};

export default async function BillingPage() {
  const member = await requireMember();
  const [billing, purchases] = await Promise.all([getMembershipBilling(member), getPurchases(member.id)]);
  const rate = member.price_tier ?? "adult";
  const years = activityYears(purchases);
  const plus = member.tier === "Insiders+";

  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-display mb-3 text-xl">Insiders+ membership</h2>
        {plus && member.comped ? (
          <div className="card text-sm">
            Your Insiders+ is complimentary{member.comp_notes ? ` (${member.comp_notes})` : ""}. There&apos;s nothing to pay.
          </div>
        ) : plus || billing?.status ? (
          <div className="card space-y-4">
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <Item label="Status" value={STATUS_LABEL[billing?.status ?? member.subscription_status ?? ""] ?? billing?.status ?? "—"} />
              <Item label="Plan" value={`${RATE_LABEL[rate]} · $${RATE_PRICE[rate]}/month`} />
              <Item
                label={billing?.cancelAtPeriodEnd ? "Ends on" : "Next bill"}
                value={billing?.nextBillDate ? `${dateShort(billing.nextBillDate)}${billing.nextBillAmount !== null ? ` · ${money(billing.nextBillAmount)}` : ""}` : "—"}
              />
              <Item label="Card" value={billing?.cardLabel ?? "—"} />
            </dl>
            {billing?.cancelAtPeriodEnd && (
              <p className="notice notice-warn text-sm">Your Insiders+ is set to end on {billing.nextBillDate ? dateShort(billing.nextBillDate) : "the end of this period"}. You can turn it back on below.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <p className="max-w-md text-xs text-[var(--muted)]">
                Billed monthly on the day you joined. Update your card, change billing details or cancel anytime. Senior and student rates are set at the box
                office with an ID.
              </p>
              {member.stripe_customer_id && <BillingPortalButton />}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--foreground)] p-6 text-[var(--background)]">
            <div>
              <p className="font-display text-2xl">Walk in free, every time.</p>
              <p className="mt-1 text-sm opacity-80">Insiders+ is ${RATE_PRICE[rate]}/month, billed on the day you join. Cancel anytime.</p>
            </div>
            <Link href="/membership" className="btn-primary">
              Upgrade to Insiders+
            </Link>
          </div>
        )}
      </section>

      {billing && billing.invoices.length > 0 && (
        <section>
          <h2 className="font-display mb-3 text-xl">Insiders+ invoices</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-bold">Date</th>
                  <th className="px-4 py-2.5 font-bold">Invoice</th>
                  <th className="px-4 py-2.5 font-bold">Status</th>
                  <th className="px-4 py-2.5 text-right font-bold">Amount</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-[var(--border)]">
                    <td className="whitespace-nowrap px-4 py-3">{dateShort(i.date)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{i.number ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{i.status}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(i.amount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {i.pdfUrl && (
                        <a href={i.pdfUrl} className="font-bold text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display mb-1 text-xl">Yearly statements</h2>
        <p className="mb-3 max-w-2xl text-sm text-[var(--muted)]">
          One PDF per year with every purchase on your account, the sales tax you paid, your Insiders+ billing and your points. Handy for your own
          records or expense reports.
        </p>
        <div className="flex flex-wrap gap-2">
          {years.map((y) => (
            <a key={y} href={`/account/statements/${y}`} className="btn-secondary !px-4 !py-2 text-sm">
              {y} statement (PDF)
            </a>
          ))}
        </div>
      </section>

      <section className="text-xs text-[var(--muted)]">
        Receipts for single purchases are on the <Link href="/account/purchases" className="font-bold underline">Purchases</Link> tab. Billing questions:
        info@royalecinemajoplin.com · 417-281-4172.
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 font-bold">{value}</dd>
    </div>
  );
}
