"use server";

import type Stripe from "stripe";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyMemberRate, insidersPlusPriceIdFor } from "@/lib/member-rate";
import { salesTaxRateId } from "@/lib/stripe-tax";
import { plusPaidFor } from "@/lib/plus-status";
import { markLegacyOnboarded } from "@/lib/legacy-plus-server";
import { linkPlusCardById } from "@/lib/member-cards";
import { recordInvoicePayment } from "@/lib/membership-payments/sync";
import { sealFinishToken } from "@/lib/plus-finish-token";
import { plusFinishUrl } from "@/lib/plus-finish-link";
import { RATE_LABEL, planPrice, type BillingInterval } from "@/lib/membership-rates";
import { memberLabel } from "@/lib/member-name";
import { maskEmail } from "@/lib/contact-mask";
import { allowAttempt } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/send";
import { unlimitedFinishHtml, unlimitedFinishSubject, unlimitedFinishText } from "@/lib/email/unlimited-finish-email";
import { firstNameOf } from "@/lib/checkin";
import type { Member, MemberPriceTier } from "@/lib/types";
import { getPosMember, type PosMember } from "./member-actions";

// Setting up a former unlimited member's Insiders+ at the register
// (lib/legacy-plus.ts). Two ways, both at the plan staff pick (standard
// $15/month unless they pick otherwise; senior and student only after an
// ID check), charged today and then every month (or year):
//
// 1. Their card on the reader. A card-present SetupIntent on the Terminal
//    reader saves the card without charging it; Stripe turns the tapped
//    card into a reusable one (the SetupAttempt's card_present
//    generated_card, attached to their Stripe customer). Then the
//    subscription is made with that card, the same shape the online
//    checkout makes (the Insiders+ price, sales tax on the item, the card as
//    its default), so the billing portal, the webhook, Reports and emails
//    all treat it like any other. A decline makes no subscription and the
//    card comes off file.
// 2. Their own phone: a link to Stripe's card page tied to their account
//    (/membership/finish), as a QR code on the customer screen or emailed.
//
// Like the reader charges, these return errors rather than throw, so staff
// see the real reason ("reader offline", "card declined").

type Plan = { tier: MemberPriceTier; interval: BillingInterval; idChecked: boolean };
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATES: MemberPriceTier[] = ["adult", "senior", "student"];
const NO_READER = "No card reader is chosen for this register. Pick one under Devices.";
const READER_OFFLINE = "Couldn't reach the card reader. Check that it's on and connected to Wi-Fi.";
const SOURCE = "pos-unlimited";

type MemberRow = Pick<Member, "id" | "name" | "email" | "phone" | "tier" | "comped" | "price_tier" | "stripe_customer_id" | "stripe_subscription_id" | "subscription_status" | "plus_gift_until">;

// "Sarah", or "Guest ·· 0199" for a phone account with no name (lib/member-name.ts).
const firstOf = (m: MemberRow) => firstNameOf(memberLabel(m.name, m.phone));

function stripeMessage(e: unknown, fallback: string) {
  return e && typeof e === "object" && "type" in e && typeof (e as { message?: unknown }).message === "string" ? (e as unknown as { message: string }).message : fallback;
}

function planError(p: Plan | null | undefined): string | null {
  if (!p || !RATES.includes(p.tier) || (p.interval !== "month" && p.interval !== "year")) return "Pick a plan first.";
  // The register's rule for these two: only after seeing an ID in person.
  if (p.tier !== "adult" && p.idChecked !== true) return `Check their ${p.tier === "senior" ? "ID for their age" : "student ID"} first.`;
  return null;
}

// "*": works before and after the migration adds the legacy columns.
async function loadMember(memberId: string): Promise<MemberRow | null> {
  if (!UUID.test(memberId)) return null;
  const { data } = await createAdminClient().from("members").select("*").eq("id", memberId).is("erased_at", null).maybeSingle();
  return (data as MemberRow | null) ?? null;
}

// Their Stripe customer, made if they have none (or theirs was deleted in
// Stripe), and saved on the member before anything else: the webhook finds
// members by it.
async function customerFor(stripe: Stripe, m: MemberRow): Promise<string> {
  if (m.stripe_customer_id) {
    const c = await stripe.customers.retrieve(m.stripe_customer_id).catch(() => null);
    if (c && !("deleted" in c && c.deleted)) return c.id;
  }
  // A phone account (lib/member-name.ts) has no email and maybe no name:
  // its Stripe customer has neither, so Stripe emails nothing (the receipt
  // is shown and printed at the register instead, PlusReceipt).
  const made = await stripe.customers.create({
    ...(m.name?.trim() ? { name: m.name.trim() } : {}),
    ...(m.email ? { email: m.email } : {}),
    metadata: { member_id: m.id, source: SOURCE },
  });
  const { error } = await createAdminClient().from("members").update({ stripe_customer_id: made.id }).eq("id", m.id);
  if (error) throw new Error("Couldn't save their billing account. Try again.");
  return made.id;
}

// ---------- 1. their card on the reader ----------

// Step 1: "save this card" on the reader, for this plan. Nothing is charged
// until the card is in and the subscription is made (step 2). The plan
// rides on the SetupIntent, so it can't change in between.
export async function startUnlimitedCard(memberId: string, readerId: string | null, plan: Plan, employeeId: string | null): Promise<Result<{ setupIntentId: string }>> {
  const staff = await assertStaff();
  if (!readerId) return { ok: false, error: NO_READER };
  const bad = planError(plan);
  if (bad) return { ok: false, error: bad };
  const m = await loadMember(memberId);
  if (!m) return { ok: false, error: "Couldn't find that member." };
  if (plusPaidFor(m)) return { ok: false, error: `${firstOf(m)} already has Insiders+ paid for.` };
  const stripe = getStripe();
  try {
    if (!(await insidersPlusPriceIdFor(plan.tier, plan.interval))) return { ok: false, error: "That Insiders+ price isn't set up in Stripe yet." };
    const customerId = await customerFor(stripe, m);
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card_present"],
      usage: "off_session",
      metadata: { source: SOURCE, member_id: m.id, price_tier: plan.tier, billing_interval: plan.interval, employee_id: employeeId || staff.employeeId || "" },
    });
    try {
      // "always": it's their membership card from now on, shown to them in
      // their billing page. They can cancel on the reader.
      await stripe.terminal.readers.processSetupIntent(readerId, {
        setup_intent: setupIntent.id,
        allow_redisplay: "always",
        process_config: { enable_customer_cancellation: true },
      });
    } catch (e) {
      await stripe.setupIntents.cancel(setupIntent.id).catch(() => {});
      throw e;
    }
    return { ok: true, setupIntentId: setupIntent.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error && !("type" in e) ? e.message : stripeMessage(e, READER_OFFLINE) };
  }
}

// What was charged, for the register to show and print (Stripe emails a
// receipt only to a customer with an email; a phone account has none).
// Amounts in dollars; card: "Visa ·· 4242".
export interface PlusReceipt {
  plan: string; // "Insiders+ Standard, monthly"
  subtotal: number;
  tax: number;
  total: number;
  card: string | null;
  at: string; // ISO
  invoice: string | null; // Stripe's invoice number
  next: string | null; // ISO, when it's charged again
  emailed: boolean; // Stripe has an email to send its own receipt to
}

export type UnlimitedCardStatus =
  | { status: "waiting" }
  | { status: "done"; member: PosMember | null; message: string; receipt?: PlusReceipt | null }
  // Nothing charged, nothing set up: staff can try again or use the phone.
  | { status: "failed"; message: string }
  // Charged in Stripe, but the member row didn't save: Try again finishes
  // it without a second charge.
  | { status: "unsaved"; message: string };

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

// Step 2 (polled): has the card gone in? Once it has, the subscription is
// made right away (charged today) and the member is Insiders+. Safe to call
// again: one subscription per SetupIntent (Stripe's idempotency key), and a
// member already paid for by it is just reported as done.
export async function checkUnlimitedCard(setupIntentId: string, readerId: string | null): Promise<UnlimitedCardStatus> {
  await assertStaff();
  if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) return { status: "failed", message: "That isn't a card setup." };
  const stripe = getStripe();
  let si: Stripe.SetupIntent;
  try {
    si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["latest_attempt"] });
  } catch {
    return { status: "waiting" };
  }
  if (si.metadata?.source !== SOURCE) return { status: "failed", message: "That isn't an Insiders+ card setup." };
  if (si.status === "succeeded") return finishFromCard(stripe, si);
  if (si.status === "canceled") return { status: "failed", message: "Cancelled. Nothing was charged." };

  // The reader's own answer: the customer pressed Cancel on it, the card
  // was declined, or it stopped waiting.
  if (readerId) {
    const reader = await stripe.terminal.readers.retrieve(readerId).catch(() => null);
    const action = reader && !("deleted" in reader && reader.deleted) ? reader.action : null;
    const showing = action?.type === "process_setup_intent" ? idOf(action.process_setup_intent?.setup_intent) : null;
    if (showing === si.id && action?.status === "failed") {
      await stripe.setupIntents.cancel(si.id).catch(() => {});
      return { status: "failed", message: `${action.failure_message || "The reader stopped."} Nothing was charged.` };
    }
  }
  if (si.last_setup_error) {
    if (readerId) await stripe.terminal.readers.cancelAction(readerId).catch(() => {});
    await stripe.setupIntents.cancel(si.id).catch(() => {});
    return { status: "failed", message: `${si.last_setup_error.message ?? "The card wasn't accepted."} Nothing was charged.` };
  }
  return { status: "waiting" };
}

async function finishFromCard(stripe: Stripe, si: Stripe.SetupIntent): Promise<UnlimitedCardStatus> {
  const attempt = si.latest_attempt && typeof si.latest_attempt === "object" ? si.latest_attempt : null;
  const paymentMethodId = idOf(attempt?.payment_method_details?.card_present?.generated_card);
  if (!paymentMethodId) {
    return { status: "failed", message: "That card can't be kept on file (phone and watch wallets usually can't). Try a physical card, or finish on their phone. Nothing was charged." };
  }
  const memberId = si.metadata?.member_id ?? "";
  const tier = (RATES.includes(si.metadata?.price_tier as MemberPriceTier) ? si.metadata?.price_tier : "adult") as MemberPriceTier;
  const interval: BillingInterval = si.metadata?.billing_interval === "year" ? "year" : "month";
  const employeeId = UUID.test(si.metadata?.employee_id ?? "") ? (si.metadata?.employee_id as string) : null;
  const customerId = idOf(si.customer);
  const m = await loadMember(memberId);
  if (!m || !customerId) return { status: "failed", message: "Couldn't find that member anymore. Nothing was charged." };

  // Already paid for: by this card a moment ago (an earlier check got
  // here first), or some other way since (then this card isn't needed).
  if (plusPaidFor(m)) {
    const mine = m.stripe_subscription_id
      ? await stripe.subscriptions
          .retrieve(m.stripe_subscription_id, { expand: ["latest_invoice"] })
          .then((s) => (s.metadata?.setup_intent === si.id ? s : null))
          .catch(() => null)
      : null;
    if (mine) {
      const inv = mine.latest_invoice && typeof mine.latest_invoice === "object" ? mine.latest_invoice : null;
      return {
        status: "done",
        member: await getPosMember(m.id),
        message: `${firstOf(m)} is Insiders+ now.`,
        receipt: inv ? plusReceipt(inv, mine, tier, interval, await cardOf(stripe, paymentMethodId), !!m.email) : null,
      };
    }
    await stripe.paymentMethods.detach(paymentMethodId).catch(() => {});
    return { status: "failed", message: `${firstOf(m)} already has Insiders+ paid for, so this card wasn't charged.` };
  }

  let sub: Stripe.Subscription;
  try {
    const priceId = await insidersPlusPriceIdFor(tier, interval);
    if (!priceId) return { status: "failed", message: "That Insiders+ price isn't set up in Stripe yet. Nothing was charged." };
    const taxRate = await salesTaxRateId();
    sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        // As the online checkout makes it: the price, with sales tax on top.
        items: [{ price: priceId, tax_rates: [taxRate] }],
        default_payment_method: paymentMethodId,
        // Charged today. A decline makes no subscription at all.
        payment_behavior: "error_if_incomplete",
        off_session: true,
        metadata: { source: SOURCE, member_id: m.id, setup_intent: si.id, price_tier: tier, billing_interval: interval },
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `unlimited-sub:${si.id}` },
    );
  } catch (e) {
    const type = e && typeof e === "object" ? (e as { type?: string }).type : undefined;
    // Stripe answered no: a decline, or a request it won't take. No
    // subscription was made; the card comes off file again.
    if (type === "StripeCardError" || type === "StripeInvalidRequestError") {
      await stripe.paymentMethods.detach(paymentMethodId).catch(() => {});
      const why = stripeMessage(e, "the card didn't go through").replace(/\.$/, "");
      return { status: "failed", message: `${type === "StripeCardError" ? "Declined" : "Stripe said no"}: ${why}. Nothing was charged. Try another card, or finish on their phone.` };
    }
    // No answer (a connection drop): it may or may not have gone through.
    // Trying again gets the same subscription back, never a second one.
    return { status: "unsaved", message: "Couldn't reach Stripe to finish. Tap Try again: it won't charge twice." };
  }

  // Their default card for future bills, and the one the billing portal shows.
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } }).catch(() => {});

  // What the webhook and the online checkout write (lib/plus-activate.ts).
  // A senior or student rate records who checked the ID, as a rate switch does.
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("members")
    .update({
      tier: "Insiders+",
      price_tier: tier,
      ...(tier !== "adult" || (m.price_tier ?? "adult") !== tier ? { price_tier_set_by: employeeId, price_tier_set_at: now } : {}),
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      monthly_member: true,
      billing_interval: interval,
    })
    .eq("id", m.id);
  if (error) return { status: "unsaved", message: "Charged and set up in Stripe, but it didn't save here. Tap Try again: it won't charge twice." };

  await markLegacyOnboarded(m.id, "reader", employeeId);
  const invoice = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
  // After the answer: the card linked for points, and the first charge into
  // Reports (both best effort; the Reports sync reads it anyway).
  after(async () => {
    await linkPlusCardById(m.id, paymentMethodId);
    if (invoice?.id) await recordInvoicePayment(invoice.id);
  });
  revalidatePath("/admin/members");
  const charged = invoice ? `$${(invoice.amount_paid / 100).toFixed(2)}` : null;
  return {
    status: "done",
    member: await getPosMember(m.id),
    message: `${firstOf(m)} is Insiders+ now: ${planPrice(tier, interval)} plus tax${charged ? `, ${charged} charged today` : ""}.`,
    receipt: invoice ? plusReceipt(invoice, sub, tier, interval, await cardOf(stripe, paymentMethodId), !!m.email) : null,
  };
}

// The kept card's brand and last four, for the receipt. Null if Stripe
// doesn't answer (the receipt then leaves the card line off).
async function cardOf(stripe: Stripe, paymentMethodId: string): Promise<{ brand: string | null; last4: string | null } | null> {
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
  return pm?.card ? { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null } : null;
}

function plusReceipt(
  invoice: Stripe.Invoice,
  sub: Stripe.Subscription,
  tier: MemberPriceTier,
  interval: BillingInterval,
  card: { brand: string | null; last4: string | null } | null,
  emailed: boolean,
): PlusReceipt {
  const tax = (invoice.total_taxes ?? []).reduce((s, t) => s + t.amount, 0);
  const periodEnd = (sub.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const brand = card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card";
  return {
    plan: `Insiders+ ${tier === "adult" ? "Standard" : RATE_LABEL[tier]}, ${interval === "year" ? "yearly" : "monthly"}`,
    subtotal: (invoice.total_excluding_tax ?? invoice.total - tax) / 100,
    tax: tax / 100,
    total: invoice.amount_paid / 100,
    card: card?.last4 ? `${brand} ·· ${card.last4}` : null,
    at: new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000).toISOString(),
    invoice: invoice.number ?? null,
    next: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    emailed,
  };
}

// Cancel before the card goes in. The reader is cleared only while it's
// still showing this setup.
export async function cancelUnlimitedCard(setupIntentId: string, readerId: string | null): Promise<void> {
  await assertStaff();
  if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) return;
  const stripe = getStripe();
  if (readerId) {
    const reader = await stripe.terminal.readers.retrieve(readerId).catch(() => null);
    const action = reader && !("deleted" in reader && reader.deleted) ? reader.action : null;
    const showing = action?.type === "process_setup_intent" ? idOf(action.process_setup_intent?.setup_intent) : null;
    if (!reader || showing === setupIntentId) await stripe.terminal.readers.cancelAction(readerId).catch(() => {});
  }
  await stripe.setupIntents.cancel(setupIntentId).catch(() => {});
}

// ---------- 2. their own phone ----------

// A link to Stripe's card page for this member and plan: for the customer
// screen's QR code (good for 30 minutes), or emailed to the address on
// their account (good for 7 days; only when staff press the button). A
// senior or student rate is saved on the member now, with who checked the
// ID, as the rate switch does.
export async function unlimitedPhoneLink(
  memberId: string,
  plan: Plan,
  how: "tablet" | "email",
  employeeId: string | null,
): Promise<Result<{ url: string | null; firstName: string; message: string }>> {
  const staff = await assertStaff();
  const bad = planError(plan);
  if (bad) return { ok: false, error: bad };
  const m = await loadMember(memberId);
  if (!m) return { ok: false, error: "Couldn't find that member." };
  const name = firstOf(m);
  if (plusPaidFor(m)) return { ok: false, error: `${name} already has Insiders+ paid for.` };
  // Stripe's page sends its receipts there, and it's how their account is found.
  if (!m.email) return { ok: false, error: "No email on their account, so Stripe's page can't be tied to it. Take their card on the reader instead." };
  if ((m.price_tier ?? "adult") !== plan.tier) {
    const r = await applyMemberRate(m.id, plan.tier, employeeId || staff.employeeId);
    if (!r.ok) return { ok: false, error: r.error };
  }
  const token = sealFinishToken({ memberId: m.id, kind: how, tier: plan.tier, interval: plan.interval });
  if (!token) return { ok: false, error: "Couldn't make the link. Try again." };
  const url = plusFinishUrl(token);
  if (how === "tablet") return { ok: true, url, firstName: name, message: "The QR code is on the customer screen." };

  if (!(await allowAttempt(`unlimited-email:${m.id}`, 3, 3600))) return { ok: false, error: "Already emailed a few times this hour. Show the QR code instead." };
  const legacy = !!(m as { legacy_plus?: boolean | null }).legacy_plus;
  const email = { name: m.name, plan: planPrice(plan.tier, plan.interval), url, legacy };
  const sent = await sendEmail(m.email, unlimitedFinishSubject(legacy), unlimitedFinishHtml(email), {
    text: unlimitedFinishText(email),
    tags: [{ name: "type", value: "unlimited_finish" }],
    idempotencyKey: `unlimited-finish:${m.id}:${Math.floor(Date.now() / 60_000)}`,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, url: null, firstName: name, message: `Emailed to ${maskEmail(m.email) ?? "their address"}. The link works for 7 days.` };
}

// Whether they've finished on their phone yet: the register asks every few
// seconds while the QR code is up, and says so the moment they have.
export async function unlimitedDone(memberId: string): Promise<{ done: boolean; member: PosMember | null }> {
  await assertStaff();
  const m = await loadMember(memberId);
  if (!m) return { done: false, member: null };
  if (!plusPaidFor(m)) return { done: false, member: null };
  return { done: true, member: await getPosMember(m.id) };
}
