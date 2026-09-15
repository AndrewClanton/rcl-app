"use server";

import { getStripe } from "@/lib/stripe";

// Server-driven Stripe Terminal integration: the POS never talks to the
// reader directly (no local-network requirement, unlike the JS SDK) -- it
// just tells Stripe's API which reader to prompt, then polls the resulting
// PaymentIntent for its status while the customer taps/inserts their card
// on the physical device.

export async function startReaderPayment(amountCents: number): Promise<{ paymentIntentId: string }> {
  const readerId = process.env.STRIPE_TERMINAL_READER_ID;
  if (!readerId) throw new Error("Card reader isn't configured yet.");
  if (!(amountCents > 0)) throw new Error("Nothing to charge.");

  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
  });

  try {
    await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: paymentIntent.id });
  } catch (e) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    throw e;
  }

  return { paymentIntentId: paymentIntent.id };
}

export async function checkReaderPayment(paymentIntentId: string): Promise<{ status: string; errorMessage: string | null }> {
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return { status: paymentIntent.status, errorMessage: paymentIntent.last_payment_error?.message ?? null };
}

export async function cancelReaderPayment(paymentIntentId: string): Promise<void> {
  const readerId = process.env.STRIPE_TERMINAL_READER_ID;
  const stripe = getStripe();
  if (readerId) {
    await stripe.terminal.readers.cancelAction(readerId).catch(() => {});
  }
  await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {});
}
