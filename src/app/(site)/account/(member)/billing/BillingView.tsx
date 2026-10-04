import Link from "next/link";
import type { MembershipBilling } from "@/lib/data/member-billing";
import type { Member } from "@/lib/types";
import { ANNUAL_PRICE, RATE_LABEL, RATE_PRICE, dollars, planPrice, type BillingInterval } from "@/lib/membership-rates";
import BillingPortalButton from "../../BillingPortalButton";
import SwitchToYearly from "../../SwitchToYearly";
import { dateLong, dateShort, money } from "../format";
import PlusLink from "@/components/PlusLink";
import { giftEndsWithoutRenewal, plusNeedsCard } from "@/lib/plus-status";
import { Panel, SpecPanel, STACK, TAP } from "../ui";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Active",
  past_due: "Payment failed",
  unpaid: "Unpaid",
  canceled: "Canceled",
  incomplete: "Waiting on payment",
};

export default function BillingView({
  member,
  billing,
  years,
  giftFrom,
  prepaid = null,
}: {
  member: Member;
  billing: MembershipBilling | null;
  years: number[];
  giftFrom: string | null;
  // Paid ahead (a year on the old website) until a date, and the plan it
  // renews as (lib/paid-through.ts).
  prepaid?: { paidThrough: string; renewsAs: BillingInterval } | null;
}) {
  const rate = member.price_tier ?? "adult";
  const plus = member.tier === "Insiders+";
  const status = billing?.status ?? member.subscription_status ?? "";
  // A gifted (or prepaid) year with nothing lined up after it.
  const giftEnds = giftEndsWithoutRenewal(member);

  return (
    <div className={STACK}>
      {plusNeedsCard(member) ? (
        // Set to Insiders+ at the box office, with nothing paying for it yet.
        <section className="sheet halftone halftone-hero flex flex-wrap items-center justify-between gap-4 bg-[var(--gold)] p-5 sm:p-6">
          <div className="relative z-[1]">
            <span className="ctag ctag-red">Insiders+</span>
            <p className="font-display mt-3 text-2xl">Your Insiders+ has no card on file.</p>
            <p className="mt-1 max-w-md text-[15px]">
              It was set up at the box office. Add a card to keep it going, ${RATE_PRICE[rate]}/month or {dollars(ANNUAL_PRICE[rate])}/year (15% off), plus tax. Your perks stay on in
              the meantime.
            </p>
          </div>
          <PlusLink next="/account/billing" className={`btn-primary ${TAP} relative z-[1] w-full px-5 py-3 sm:w-auto`}>
            Add a card
          </PlusLink>
        </section>
      ) : plus && giftEnds && prepaid ? (
        // Paid ahead: a card added now isn't charged until the date, then
        // renews on the plan they had, at today's price plus tax.
        <section className="sheet halftone halftone-hero bg-[var(--gold)] p-5 sm:p-6">
          <div className="relative z-[1]">
            <span className="ctag ctag-red">Paid through</span>
            <p className="font-display mt-3 text-2xl">
              Your {prepaid.renewsAs === "year" ? "yearly " : ""}Insiders+ is paid through {dateLong(giftEnds)}.
            </p>
            <p className="mt-1 max-w-lg text-[15px]">
              Add a card now and you won&apos;t be charged until then. On {dateLong(giftEnds)} your {prepaid.renewsAs === "year" ? "next year renews at" : "membership renews at"}{" "}
              {prepaid.renewsAs === "year" ? `${dollars(ANNUAL_PRICE[rate])}` : `$${RATE_PRICE[rate]}/month`} + tax.
            </p>
            <PlusLink next="/account/billing" annual={prepaid.renewsAs === "year"} className={`btn-primary ${TAP} mt-4 inline-block px-5 py-3`}>
              Add a card
            </PlusLink>
          </div>
        </section>
      ) : plus && giftEnds ? (
        <section className="sheet halftone halftone-hero bg-[var(--gold)] p-5 sm:p-6">
          <div className="relative z-[1]">
            <span className="ctag ctag-red">A gift</span>
            <p className="font-display mt-3 text-2xl">
              Your Insiders+ is a gift{giftFrom ? ` from ${giftFrom}` : ""}, good through {dateShort(giftEnds)}.
            </p>
            <p className="mt-1 max-w-lg text-[15px]">It&apos;s paid in full, so there&apos;s nothing to pay and no card needed.</p>
            <p className="mt-4 max-w-lg text-[15px]">
              Want to keep it after that? Join now and your first charge waits until {dateShort(giftEnds)}: ${RATE_PRICE[rate]}/month or {dollars(ANNUAL_PRICE[rate])}/year (15% off), plus tax.
            </p>
            <div className="mt-3 grid gap-3 sm:flex sm:flex-wrap">
              <PlusLink next="/account/billing" className={`btn-primary ${TAP} px-5 py-3`}>
                Keep it monthly
              </PlusLink>
              <PlusLink next="/account/billing" annual className={`btn-secondary ${TAP} px-5 py-3`}>
                Keep it yearly
              </PlusLink>
            </div>
          </div>
        </section>
      ) : plus && member.comped ? (
        <section className="sheet p-5">
          <span className="ctag ctag-yellow">Insiders+</span>
          <p className="mt-3 text-[15px]">
            Your Insiders+ is complimentary{member.comp_notes ? ` (${member.comp_notes})` : ""}. There&apos;s nothing to pay.
          </p>
        </section>
      ) : plus || billing?.status ? (
        <div className="space-y-4">
          <SpecPanel
            title="Insiders+ membership"
            aside={member.billing_interval === "year" ? "Billed yearly" : "Billed monthly"}
            cells={[
              { k: "Status", v: STATUS_LABEL[status] ?? (status || "—"), hot: status === "active" || status === "trialing" },
              { k: "Plan", v: `${RATE_LABEL[rate]} · ${planPrice(rate, member.billing_interval ?? "month")}` },
              {
                k: billing?.cancelAtPeriodEnd ? "Ends on" : "Next bill",
                v: billing?.nextBillDate ? `${dateShort(billing.nextBillDate)}${billing.nextBillAmount !== null ? ` · ${money(billing.nextBillAmount)}` : ""}` : "—",
              },
              // "Visa •••• 4242" keeps its last four with the dots on a phone.
              { k: "Card", v: billing?.cardLabel?.replace(/ (?=\d+$)/, " ") ?? "—" },
            ]}
            stamp={
              status === "active" || status === "trialing" ? (
                <>
                  Member in
                  <br />
                  good standing
                </>
              ) : undefined
            }
          />
          {/* A card added while paid ahead (or with a later first charge):
              Stripe's trial until the first bill. */}
          {status === "trialing" && billing?.nextBillDate && !billing.cancelAtPeriodEnd && (
            <p className="notice notice-success">
              No charge until {dateLong(billing.nextBillDate)}.{billing.nextBillAmount !== null ? ` Then ${money(billing.nextBillAmount)}, tax included.` : ""}
            </p>
          )}
          {status === "past_due" && <p className="notice notice-warn">Your last payment didn&apos;t go through. Update your card below to keep Insiders+.</p>}
          {billing?.cancelAtPeriodEnd && (
            <p className="notice notice-warn">Your Insiders+ is set to end on {billing.nextBillDate ? dateShort(billing.nextBillDate) : "the end of this period"}. You can turn it back on below.</p>
          )}
          {member.stripe_subscription_id && member.billing_interval !== "year" && !billing?.cancelAtPeriodEnd && ["active", "trialing"].includes(billing?.status ?? "") && (
            <SwitchToYearly yearlyLabel={`${dollars(ANNUAL_PRICE[rate])}/year instead of $${RATE_PRICE[rate] * 12} for twelve months`} />
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="max-w-lg text-sm text-[var(--muted)]">
              Billed {member.billing_interval === "year" ? "once a year" : "monthly"} on the day you joined. Update your card, change billing details or cancel anytime. Senior and student rates
              are set at the box office with an ID.
            </p>
            {member.stripe_customer_id && <BillingPortalButton />}
          </div>
        </div>
      ) : (
        <section className="sheet flex flex-wrap items-center justify-between gap-4 !bg-[var(--foreground)] p-5 text-[var(--background)] sm:p-6">
          <div>
            <span className="ctag ctag-yellow">Insiders+</span>
            <p className="font-display mt-3 text-2xl text-[var(--gold)]">Walk in free, every time.</p>
            <p className="mt-1 max-w-[56ch] text-[15px] opacity-85">
              Insiders+ is ${RATE_PRICE[rate]}/month, or {dollars(ANNUAL_PRICE[rate])}/year paid up front (15% off), plus tax. Cancel anytime.
            </p>
          </div>
          <PlusLink next="/account/billing" className={`btn-primary ${TAP} w-full px-5 py-3 sm:w-auto`}>
            Get Insiders+
          </PlusLink>
        </section>
      )}

      {billing && billing.invoices.length > 0 && (
        <Panel title="Insiders+ invoices" aside={`${billing.invoices.length}`}>
          {/* The invoice number column is left off on a phone, so the rest
              fits without scrolling sideways (it's on the PDF). */}
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b-2 border-[var(--foreground)] text-left">
                  <th className="spec-k px-3 py-3 sm:px-4">Date</th>
                  <th className="spec-k hidden px-4 py-3 sm:table-cell">Invoice</th>
                  <th className="spec-k px-3 py-3 sm:px-4">Status</th>
                  <th className="spec-k px-3 py-3 text-right sm:px-4">Amount</th>
                  <th className="px-3 py-3 sm:px-4">
                    <span className="sr-only">PDF</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-[var(--border)]">
                    <td className="spec-code whitespace-nowrap px-3 py-3 sm:px-4">{dateShort(i.date)}</td>
                    <td className="hidden px-4 py-3 text-[var(--muted)] sm:table-cell">{i.number ?? "—"}</td>
                    <td className="px-3 py-3 font-bold capitalize sm:px-4">{i.status}</td>
                    <td className="font-display px-3 py-3 text-right tabular-nums sm:px-4">{money(i.amount)}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-right sm:px-4">
                      {i.pdfUrl && (
                        <a href={i.pdfUrl} className="inline-flex min-h-11 items-center font-bold text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Yearly statements">
        <div className="p-5">
          <p className="max-w-2xl text-[15px] text-[var(--muted)]">
            One PDF per year with every purchase on your account, the sales tax you paid, your Insiders+ billing and your points. Handy for your own records or
            expense reports.
          </p>
          <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap">
            {years.map((y) => (
              <a key={y} href={`/account/statements/${y}`} className={`btn-secondary ${TAP} px-4 py-2 text-sm`}>
                {y} statement (PDF)
              </a>
            ))}
          </div>
        </div>
      </Panel>

      <p className="text-sm text-[var(--muted)]">
        Receipts for single purchases are on the{" "}
        <Link href="/account/purchases" className="font-bold underline">
          Purchases
        </Link>{" "}
        tab. Billing questions: info@royalecinemajoplin.com · 417-281-4172.
      </p>
    </div>
  );
}
