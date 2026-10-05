import "server-only";
import { getStripe } from "@/lib/stripe";
import type { OrgRow } from "@/lib/orgs-server";

// An organization's monthly fee through Stripe (lib/orgs.ts): a
// subscription to the price in STRIPE_PRICE_ORG_MONTHLY ($100 a month),
// invoiced to the organization's contact email (Stripe emails the invoice,
// they pay it online within 30 days). Without the price set, Back office
// says "Billing: invoiced by hand" and the organization works the same.

export function orgPriceId(): string | null {
  return process.env.STRIPE_PRICE_ORG_MONTHLY?.trim() || null;
}

export type OrgBilling =
  | { mode: "hand" } // no price set up
  | { mode: "off" } // a price, but this organization isn't billed through Stripe yet
  | { mode: "on"; status: string; amount: number | null; nextAt: string | null; customerId: string }
  | { mode: "error"; error: string };

export async function orgBilling(org: Pick<OrgRow, "stripe_customer_id" | "stripe_subscription_id">): Promise<OrgBilling> {
  if (!orgPriceId() && !org.stripe_subscription_id) return { mode: "hand" };
  if (!org.stripe_subscription_id) return { mode: "off" };
  try {
    const sub = await getStripe().subscriptions.retrieve(org.stripe_subscription_id);
    const item = sub.items.data[0];
    const end = item?.current_period_end;
    return {
      mode: "on",
      status: sub.status,
      amount: item?.price?.unit_amount != null ? item.price.unit_amount / 100 : null,
      nextAt: sub.status === "canceled" || !end ? null : new Date(end * 1000).toISOString(),
      customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    };
  } catch (e) {
    return { mode: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

// Starts the monthly subscription: a Stripe customer for the organization
// (made once) and a subscription invoiced to its contact email.
export async function startOrgSubscription(org: OrgRow): Promise<{ ok: true; customerId: string; subscriptionId: string } | { ok: false; error: string }> {
  const price = orgPriceId();
  if (!price) return { ok: false, error: "STRIPE_PRICE_ORG_MONTHLY isn't set, so this organization is invoiced by hand." };
  if (!org.contact_email) return { ok: false, error: "Add the organization's contact email first: Stripe sends the monthly invoice there." };
  const stripe = getStripe();
  try {
    const customerId =
      org.stripe_customer_id ??
      (
        await stripe.customers.create(
          { name: org.name, email: org.contact_email, metadata: { organization_id: org.id, contact: org.contact_name ?? "" } },
          { idempotencyKey: `org-customer-${org.id}` },
        )
      ).id;
    const sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price }],
        collection_method: "send_invoice",
        days_until_due: 30,
        metadata: { organization_id: org.id },
        description: `${org.name}: Royale Cinema organization account`,
      },
      { idempotencyKey: `org-subscription-${org.id}-${Date.now().toString(36).slice(0, -4)}` },
    );
    return { ok: true, customerId, subscriptionId: sub.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function stopOrgSubscription(subscriptionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getStripe().subscriptions.cancel(subscriptionId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
