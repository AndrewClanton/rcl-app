"use server";

import { getStripe } from "@/lib/stripe";
import { assertStaff } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";

// Server-driven Stripe Terminal integration: the POS never talks to the
// reader directly (no local-network requirement, unlike the JS SDK) -- it
// just tells Stripe's API which reader to prompt, then polls the resulting
// PaymentIntent for its status while the customer taps/inserts their card
// on the physical device.
//
// There can be more than one reader (the bar has two WisePOS E), so each
// register device picks its own under Devices, and passes that reader's id
// with every charge.
//
// Charges return their error instead of throwing: production hides a thrown
// error's message, and "the reader is offline" is exactly what staff need
// to see.

export type ReaderStart = { ok: true; paymentIntentId: string } | { ok: false; error: string };

export interface ReaderOption {
  id: string;
  label: string;
  online: boolean;
}

// Every reader registered to the Stripe account, for the Devices picker.
export async function listReaders(): Promise<{ ok: true; readers: ReaderOption[] } | { ok: false; error: string }> {
  await assertStaff();
  try {
    const { data } = await getStripe().terminal.readers.list({ limit: 100 });
    return {
      ok: true,
      readers: data.map((r) => ({ id: r.id, label: r.label || r.serial_number || r.id, online: r.status === "online" })),
    };
  } catch {
    return { ok: false, error: "Couldn't load the card readers from Stripe. Check the connection and try again." };
  }
}

async function assertReader(readerId: string) {
  if (!readerId) throw new UserFacingError("No card reader is chosen for this register. Pick one under Devices.");
  const reader = await getStripe()
    .terminal.readers.retrieve(readerId)
    .catch(() => null);
  if (!reader || ("deleted" in reader && reader.deleted)) throw new UserFacingError("That card reader isn't registered in Stripe anymore. Pick another under Devices.");
}

export async function startReaderPayment(amountCents: number, readerId: string): Promise<ReaderStart> {
  await assertStaff();
  if (!(amountCents > 0)) return { ok: false, error: "Nothing to charge." };
  try {
    await assertReader(readerId);
    return { ok: true, paymentIntentId: await sendToReader(amountCents, readerId) };
  } catch (e) {
    // UserFacingError is ours; Stripe's own messages ("Reader is currently
    // offline...") are written for merchants, so both are fine to show.
    const stripeMessage = e && typeof e === "object" && "type" in e && typeof (e as { message?: unknown }).message === "string" ? (e as unknown as { message: string }).message : null;
    return { ok: false, error: e instanceof UserFacingError ? e.message : (stripeMessage ?? "Couldn't reach the card reader. Check that it's on and connected to Wi-Fi.") };
  }
}

async function sendToReader(amountCents: number, readerId: string): Promise<string> {
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    metadata: { source: "pos", reader_id: readerId },
  });

  try {
    await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: paymentIntent.id });
  } catch (e) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    throw e;
  }

  return paymentIntent.id;
}

export async function checkReaderPayment(paymentIntentId: string): Promise<{ status: string; errorMessage: string | null }> {
  await assertStaff();
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return { status: paymentIntent.status, errorMessage: paymentIntent.last_payment_error?.message ?? null };
}

export async function cancelReaderPayment(paymentIntentId: string, readerId: string): Promise<void> {
  await assertStaff();
  const stripe = getStripe();
  if (readerId) await stripe.terminal.readers.cancelAction(readerId).catch(() => {});
  await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {});
}
