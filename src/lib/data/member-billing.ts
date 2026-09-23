import "server-only";
import { getStripe } from "@/lib/stripe";
import type { Member } from "@/lib/types";

// A member's Insiders+ billing, read live from Stripe (the source of truth
// for what they've actually been charged). Each part fails soft: if Stripe
// is unreachable the account page still loads, just without that section.

export interface MembershipInvoice {
  id: string;
  number: string | null;
  date: string;
  amount: number;
  status: string;
  pdfUrl: string | null;
  viewUrl: string | null;
}

export interface MembershipBilling {
  status: string | null;
  cancelAtPeriodEnd: boolean;
  nextBillDate: string | null;
  nextBillAmount: number | null;
  cardLabel: string | null;
  invoices: MembershipInvoice[];
}

export async function getMembershipBilling(member: Member): Promise<MembershipBilling | null> {
  if (!member.stripe_customer_id) return null;
  const stripe = getStripe();
  const result: MembershipBilling = { status: member.subscription_status, cancelAtPeriodEnd: false, nextBillDate: null, nextBillAmount: null, cardLabel: null, invoices: [] };

  try {
    const invoices = await stripe.invoices.list({ customer: member.stripe_customer_id, limit: 36 });
    result.invoices = invoices.data
      .filter((i) => i.status !== "draft")
      .map((i) => ({
        id: i.id ?? "",
        number: i.number,
        date: new Date(i.created * 1000).toISOString(),
        amount: (i.status === "paid" ? i.amount_paid : i.amount_due) / 100,
        status: i.status ?? "open",
        pdfUrl: i.invoice_pdf ?? null,
        viewUrl: i.hosted_invoice_url ?? null,
      }));
  } catch {
    // leave invoices empty
  }

  if (member.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(member.stripe_subscription_id, { expand: ["default_payment_method"] });
      result.status = sub.status;
      result.cancelAtPeriodEnd = sub.cancel_at_period_end;
      const periodEnd = (sub.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
      if (periodEnd && ["active", "trialing", "past_due"].includes(sub.status)) {
        result.nextBillDate = new Date(periodEnd * 1000).toISOString();
        if (!sub.cancel_at_period_end) {
          const preview = await stripe.invoices.createPreview({ customer: member.stripe_customer_id, subscription: sub.id }).catch(() => null);
          result.nextBillAmount = preview ? preview.amount_due / 100 : null;
        }
      }
      const pm = sub.default_payment_method;
      if (pm && typeof pm !== "string" && pm.card) {
        result.cardLabel = `${pm.card.brand[0].toUpperCase()}${pm.card.brand.slice(1)} ending ${pm.card.last4}`;
      }
    } catch {
      // leave subscription details empty
    }
  }
  return result;
}
