import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email/send";
import { orgInvoiceHtml, orgInvoiceSubject, orgInvoiceText } from "@/lib/email/org-invoice-email";
import { getOrgInvoice } from "@/lib/data/org-invoices";
import { cleanInviteEmail } from "@/lib/org-invite-server";
import { allowAttempt } from "@/lib/rate-limit";
import { isReceipt, monthTitle, type PaidMethod, type PayStatus } from "@/lib/org-invoices";
import type { StaffSession } from "@/lib/auth";

// Organization invoices on the server (lib/org-invoices.ts): emailing the
// month's invoice/receipt (transactional, the receipts sender, logged in
// org_invoice_sends), the payment status, and the Stripe payment link for
// the amount due. The link is made only when staff press the button, never
// on its own.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const INVOICE_SENDS_PER_HOUR = 10;

const by = (staff: StaffSession) => ({ status_by: staff.employeeId, status_by_name: staff.name.slice(0, 120) });

// The org_invoices row for the month, made or changed.
async function saveInvoice(orgId: string, month: string, fields: Record<string, unknown>): Promise<Result> {
  const { error } = await createAdminClient()
    .from("org_invoices")
    .upsert({ organization_id: orgId, month, ...fields, updated_at: new Date().toISOString() }, { onConflict: "organization_id,month" });
  return error ? { ok: false, error: "Couldn't save that. Try again." } : { ok: true };
}

export async function setInvoiceStatus(orgId: string, month: string, status: PayStatus, method: PaidMethod | null, staff: StaffSession): Promise<Result> {
  if (status === "paid" && !method) return { ok: false, error: "Pick how they paid: cash, check or card." };
  return saveInvoice(orgId, month, {
    status,
    paid_method: status === "paid" ? method : null,
    paid_at: status === "paid" ? new Date().toISOString() : null,
    ...by(staff),
  });
}

export async function setInvoiceFee(orgId: string, month: string, include: boolean, staff: StaffSession): Promise<Result> {
  return saveInvoice(orgId, month, { include_fee: include, ...by(staff) });
}

export async function sendOrgInvoice(orgId: string, month: string, rawEmail: unknown, staff: StaffSession): Promise<Result<{ to: string }>> {
  const inv = await getOrgInvoice(orgId, month);
  if (!inv) return { ok: false, error: "Couldn't find that organization." };
  const to = cleanInviteEmail(rawEmail ?? inv.org.contact_email);
  if (!to) return { ok: false, error: inv.org.contact_email ? "That email doesn't look right." : "Add the organization's contact email first, or type an address." };
  if (!(await allowAttempt(`org-invoice:${orgId}`, INVOICE_SENDS_PER_HOUR, 3600))) {
    return { ok: false, error: `That's ${INVOICE_SENDS_PER_HOUR} invoice emails for ${inv.org.name} in the last hour. Try again later.` };
  }
  const d = inv.doc;
  const sent = await sendEmail(to, orgInvoiceSubject(d), orgInvoiceHtml(d), {
    text: orgInvoiceText(d),
    tags: [{ name: "category", value: "org_invoice" }],
  });
  if (!sent.ok) return sent;
  const { error } = await createAdminClient()
    .from("org_invoice_sends")
    .insert({
      organization_id: orgId,
      month,
      email: to,
      kind: isReceipt(d) ? "receipt" : "invoice",
      amount_due: d.totals.due,
      covered: d.totals.covered,
      sent_by: staff.employeeId,
      sent_by_name: staff.name.slice(0, 120),
      resend_id: sent.id,
    });
  if (error) console.error("org_invoice_sends insert:", error.message);
  return { ok: true, to };
}

// A Stripe payment link for the amount due (one payment, then it closes).
// A link for an older amount is switched off.
export async function makeOrgPayLink(orgId: string, month: string, staff: StaffSession): Promise<Result<{ url: string }>> {
  const inv = await getOrgInvoice(orgId, month);
  if (!inv) return { ok: false, error: "Couldn't find that organization." };
  if (inv.doc.status !== "unpaid") return { ok: false, error: "This invoice is already paid or waived." };
  const due = inv.doc.totals.due;
  if (due < 0.5) return { ok: false, error: "There's nothing (or under 50¢) to pay by card." };
  if (inv.payLinkCurrent && inv.invoice?.pay_link_url) return { ok: true, url: inv.invoice.pay_link_url };
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    return { ok: false, error: "Stripe isn't set up (STRIPE_SECRET_KEY missing)." };
  }
  let link: Stripe.PaymentLink;
  try {
    const name = `${inv.org.name}: ${monthTitle(month)} invoice ${inv.doc.number}`;
    const metadata = { org_invoice_org: orgId, org_invoice_month: month };
    link = await stripe.paymentLinks.create(
      {
        line_items: [{ price_data: { currency: "usd", unit_amount: Math.round(due * 100), product_data: { name: name.slice(0, 250) } }, quantity: 1 }],
        metadata,
        payment_intent_data: { description: name.slice(0, 250), metadata },
        restrictions: { completed_sessions: { limit: 1 } },
        after_completion: { type: "hosted_confirmation", hosted_confirmation: { custom_message: "Thank you! Your payment is in. The RCL crew" } },
      },
      { idempotencyKey: `org-paylink-${orgId}-${month}-${Math.round(due * 100)}-${Date.now().toString(36).slice(0, -4)}` },
    );
  } catch (e) {
    return { ok: false, error: `Stripe said: ${e instanceof Error ? e.message : String(e)}` };
  }
  const old = inv.invoice?.pay_link_id;
  if (old && old !== link.id) await stripe.paymentLinks.update(old, { active: false }).catch(() => null);
  const saved = await saveInvoice(orgId, month, { pay_link_id: link.id, pay_link_url: link.url, pay_link_amount: due, ...by(staff) });
  if (!saved.ok) console.error("org pay link not saved", orgId, month, link.id);
  return { ok: true, url: link.url };
}

// The Stripe webhook: a payment link's checkout finished, so its invoice is
// paid by card. Safe to run twice. False when the save failed (Stripe
// re-sends the event).
export async function invoicePaidFromCheckout(session: Stripe.Checkout.Session): Promise<boolean> {
  const linkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  if (!linkId || session.payment_status !== "paid") return true;
  const { error } = await createAdminClient()
    .from("org_invoices")
    .update({ status: "paid", paid_method: "card", paid_at: new Date().toISOString(), status_by: null, status_by_name: "Paid online (card link)", updated_at: new Date().toISOString() })
    .eq("pay_link_id", linkId)
    .eq("status", "unpaid");
  return !error;
}
