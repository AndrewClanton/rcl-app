"use server";

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentMemberId } from "@/lib/member-forward";
import { checkManagerPin } from "@/lib/manager-pin";
import { chargeSavedCard } from "@/lib/saved-card-charge";

// "Charge card on file" for a member at checkout: their own saved card (the
// one Insiders+ bills, saved online or on the reader), charged without a tap,
// once they've said yes on the customer screen (or told staff, with a
// manager's PIN). Charged through lib/saved-card-charge.ts, the same path as a
// tab's card on file, as a customer-initiated payment.
//
// Two steps, like a reader charge: the payment is made first (nothing
// charged), so the register keeps its id before it's confirmed and a reload
// mid-charge still finds it (PosApp recoverReaderPayments). It carries
// metadata.source "pos", so the sale, Reports, refunds, card points and
// Register checks treat it as any register card sale; card_on_file "member"
// and consent ("tablet" or "verbal", with the approving manager) say how.

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PI = /^pi_[A-Za-z0-9]+$/;
const ATTEMPT = /^[A-Za-z0-9:-]{8,80}$/;
// Most a card on file takes at the register in one go.
const MAX_CENTS = 200_000;

function cardLabel(brand: string | null | undefined, last4: string | null | undefined) {
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
  return last4 ? `${name} ••${last4}` : name;
}

// Good through the end of its expiry month.
function usable(pm: Stripe.PaymentMethod | null | undefined): pm is Stripe.PaymentMethod & { card: Stripe.PaymentMethod.Card } {
  if (!pm || pm.type !== "card" || !pm.card) return false;
  const { exp_year: y, exp_month: m } = pm.card;
  if (!y || !m) return true;
  return new Date(Date.UTC(y, m, 1)).getTime() > Date.now();
}

// Their card: the customer's default, then their subscription's, then any
// other card saved on them. Null if there's none that works.
async function memberCard(memberId: string): Promise<{ memberId: string; customerId: string; pm: Stripe.PaymentMethod & { card: Stripe.PaymentMethod.Card } } | null> {
  if (typeof memberId !== "string" || !UUID.test(memberId)) return null;
  const id = (await currentMemberId(memberId)) ?? memberId;
  const { data: m } = await createAdminClient().from("members").select("id, stripe_customer_id, stripe_subscription_id, erased_at").eq("id", id).maybeSingle();
  if (!m?.stripe_customer_id || m.erased_at) return null;
  const stripe = getStripe();
  const opts = { timeout: 8000, maxNetworkRetries: 1 };
  const customer = await stripe.customers.retrieve(m.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] }, opts);
  if ("deleted" in customer && customer.deleted) return null;
  const pick = (pm: unknown) => (pm && typeof pm === "object" && usable(pm as Stripe.PaymentMethod) ? (pm as Stripe.PaymentMethod & { card: Stripe.PaymentMethod.Card }) : null);
  let pm = pick(customer.invoice_settings?.default_payment_method);
  if (!pm && m.stripe_subscription_id) {
    const sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id, { expand: ["default_payment_method"] }, opts).catch(() => null);
    if (sub && sub.customer === customer.id) pm = pick(sub.default_payment_method);
  }
  if (!pm) {
    const { data } = await stripe.paymentMethods.list({ customer: customer.id, type: "card", limit: 10 }, opts);
    pm = data.map(pick).find((p) => p !== null) ?? null;
  }
  return pm ? { memberId: m.id, customerId: customer.id, pm } : null;
}

// For the payment screen's button: "Visa ••4242", or null if there's no
// card that works (or Stripe didn't answer: then they tap as usual).
export async function getMemberCardOnFile(memberId: string): Promise<{ label: string } | null> {
  await assertStaff();
  try {
    const c = await memberCard(memberId);
    return c ? { label: cardLabel(c.pm.card.brand, c.pm.card.last4) } : null;
  } catch {
    return null;
  }
}

// Step 1: the payment, not charged yet. attempt: one per "yes" (and tip), so
// asking again after no answer gets this same payment back.
export async function startMemberCardCharge(memberId: string, amountCents: number, tipCents: number, attempt: string): Promise<Result<{ paymentIntentId: string; label: string }>> {
  const staff = await assertStaff();
  if (!Number.isInteger(amountCents) || amountCents < 50 || amountCents > MAX_CENTS) return { ok: false, error: "That amount can't go on a card on file." };
  if (!Number.isInteger(tipCents) || tipCents < 0 || tipCents > amountCents) return { ok: false, error: "That tip doesn't add up." };
  if (typeof attempt !== "string" || !ATTEMPT.test(attempt)) return { ok: false, error: "Couldn't start that charge. Try again." };
  let card: Awaited<ReturnType<typeof memberCard>>;
  try {
    card = await memberCard(memberId);
  } catch {
    return { ok: false, error: "Couldn't reach Stripe to find their card. Use the reader." };
  }
  if (!card) return { ok: false, error: "This member has no card on file that works. Use the reader." };
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: card.customerId,
        payment_method: card.pm.id,
        payment_method_types: ["card"],
        metadata: { source: "pos", card_on_file: "member", member_id: card.memberId, tip_cents: String(tipCents), employee_id: staff.employeeId ?? "" },
      },
      { idempotencyKey: `member-cof:${card.memberId}:${attempt}:${amountCents}` },
    );
    return { ok: true, paymentIntentId: pi.id, label: cardLabel(card.pm.card.brand, card.pm.card.last4) };
  } catch {
    return { ok: false, error: "Couldn't reach Stripe. Try again, or use the reader." };
  }
}

export type MemberChargeResult =
  | { ok: true; amountCents: number }
  // declined: nothing was charged, and the payment is canceled: use the
  // reader. pin: the manager PIN was wrong (nothing tried yet). Otherwise no
  // answer: Charge again is safe (same payment).
  | { ok: false; error: string; declined?: boolean; pin?: boolean };

// Step 2: charge it. consent: the guest's "Yes, charge it" on the customer
// screen, or staff heard them say yes and a manager's PIN backs that up.
export async function confirmMemberCardCharge(paymentIntentId: string, consent: { how: "tablet" } | { how: "verbal"; pin: string }): Promise<MemberChargeResult> {
  const staff = await assertStaff();
  if (typeof paymentIntentId !== "string" || !PI.test(paymentIntentId)) return { ok: false, error: "That isn't a card payment.", declined: true };
  const stripe = getStripe();
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { timeout: 8000, maxNetworkRetries: 1 });
  } catch {
    return { ok: false, error: "Couldn't reach Stripe. Tap Charge again: it won't charge twice." };
  }
  if (pi.metadata?.card_on_file !== "member" || pi.metadata?.source !== "pos") return { ok: false, error: "That isn't a card-on-file payment.", declined: true };
  if (pi.status === "succeeded") return { ok: true, amountCents: pi.amount_received };
  if (pi.status === "canceled") return { ok: false, error: "That charge was canceled. Nothing was charged.", declined: true };
  const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  if (!customerId || !paymentMethodId) return { ok: false, error: "That payment has no card on it.", declined: true };

  let approverId = "";
  if (consent?.how === "verbal") {
    const approval = await checkManagerPin(consent.pin, "card-on-file-verbal", staff.employeeId, paymentIntentId);
    if (!approval.ok) return { ok: false, error: approval.error, pin: true };
    approverId = approval.approverId ?? "unknown";
  } else if (consent?.how !== "tablet") {
    return { ok: false, error: "The guest has to say yes first.", declined: true };
  }
  // How they said yes, kept on the payment (Stripe, and Register checks).
  try {
    await stripe.paymentIntents.update(paymentIntentId, { metadata: { consent: consent.how, ...(approverId ? { consent_approver_id: approverId } : {}) } });
  } catch {
    return { ok: false, error: "Couldn't reach Stripe. Tap Charge again: it won't charge twice." };
  }
  console.info(`[card-on-file] ${paymentIntentId} member ${pi.metadata.member_id} consent=${consent.how}${approverId ? ` approver=${approverId}` : ""} by ${staff.employeeId}`);

  const r = await chargeSavedCard({
    amountCents: pi.amount,
    customerId,
    paymentMethodId,
    customerPresent: true,
    paymentIntentId,
    idempotencyKey: `member-cof-confirm:${paymentIntentId}`,
  });
  if (r.ok) return { ok: true, amountCents: r.paymentIntent.amount_received };
  if (r.declined) return { ok: false, error: `Card declined, use the reader. (${r.error.replace(/\.$/, "")}.)`, declined: true };
  return { ok: false, error: `${r.error} Tap Charge again: it won't charge twice.` };
}
