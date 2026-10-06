import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";

// Charging a card that's saved in Stripe, with no tap: the one way the
// register does it, for a tab's card on file (pos/tab-card-actions.ts) and a
// member's own card on file (pos/member-card-actions.ts).
//
// customerPresent: the guest is standing there and said yes (a member's card
// at checkout): a customer-initiated payment with a saved card, confirmed
// on-session, so Stripe treats it as the cardholder paying, not the business
// charging them later. If the bank wants the cardholder to approve it (3D
// Secure), that can't happen at the bar, so it's canceled and they tap
// instead. Not present (a tab closing): off_session, as before.

export type SavedCardResult =
  | { ok: true; paymentIntent: Stripe.PaymentIntent }
  // declined: the bank said no (or wants approval we can't get here); nothing
  // was charged. Otherwise Stripe didn't answer: it may have gone through,
  // and trying again with the same idempotency key is safe.
  | { ok: false; declined: boolean; error: string };

function stripeMessage(e: unknown): string | null {
  return e && typeof e === "object" && "type" in e && typeof (e as { message?: unknown }).message === "string" ? (e as unknown as { message: string }).message : null;
}

function errorType(e: unknown): string | undefined {
  return e && typeof e === "object" ? (e as { type?: string }).type : undefined;
}

const NEEDS_APPROVAL = "This card needs the cardholder to approve the charge with their bank, which can't be done here.";

export async function chargeSavedCard(opts: {
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  customerPresent: boolean;
  metadata?: Record<string, string>;
  // A payment made beforehand (unconfirmed) to confirm now, instead of
  // making one: so the register can keep its id before anything's charged.
  paymentIntentId?: string;
  idempotencyKey?: string;
}): Promise<SavedCardResult> {
  const stripe = getStripe();
  const session = opts.customerPresent ? {} : { off_session: true };
  const options = opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined;
  let pi: Stripe.PaymentIntent;
  try {
    pi = opts.paymentIntentId
      ? await stripe.paymentIntents.confirm(opts.paymentIntentId, { payment_method: opts.paymentMethodId, ...session }, options)
      : await stripe.paymentIntents.create(
          {
            amount: opts.amountCents,
            currency: "usd",
            customer: opts.customerId,
            payment_method: opts.paymentMethodId,
            payment_method_types: ["card"],
            ...session,
            confirm: true,
            metadata: opts.metadata,
          },
          options,
        );
  } catch (e) {
    const type = errorType(e);
    if (type === "StripeCardError") {
      const code = (e as { code?: string }).code;
      // A decline leaves the payment open: canceled, so nothing can charge it later.
      const id = (e as { payment_intent?: { id?: string } }).payment_intent?.id ?? opts.paymentIntentId;
      if (id) await stripe.paymentIntents.cancel(id).catch(() => {});
      return { ok: false, declined: true, error: code === "authentication_required" ? NEEDS_APPROVAL : (stripeMessage(e) ?? "The card was declined.") };
    }
    if (type === "StripeInvalidRequestError") return { ok: false, declined: true, error: stripeMessage(e) ?? "Stripe wouldn't take that charge." };
    return { ok: false, declined: false, error: "Couldn't hear back from Stripe." };
  }
  if (pi.status === "succeeded") return { ok: true, paymentIntent: pi };
  if (pi.status === "processing") return { ok: false, declined: false, error: "The card is still being charged." };
  await stripe.paymentIntents.cancel(pi.id).catch(() => {});
  return { ok: false, declined: true, error: pi.status === "requires_action" ? NEEDS_APPROVAL : "The card didn't go through." };
}
