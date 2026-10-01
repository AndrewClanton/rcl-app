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

// UserFacingError is ours; Stripe's own messages ("Reader is currently
// offline...") are written for merchants, so both are fine to show.
function chargeError(e: unknown): string {
  const stripeMessage = e && typeof e === "object" && "type" in e && typeof (e as { message?: unknown }).message === "string" ? (e as unknown as { message: string }).message : null;
  return e instanceof UserFacingError ? e.message : (stripeMessage ?? "Couldn't reach the card reader. Check that it's on and connected to Wi-Fi.");
}

// A reader charge is two steps, so the register can keep the payment's id
// (keepPendingReaderSale) before the reader shows it: a reload at any point
// after step 1 still finds the payment, and stops it or records it.
//
// Step 1: the payment, not on the reader yet. Nothing can charge it until
// step 2.
export async function createReaderPayment(amountCents: number, readerId: string): Promise<ReaderStart> {
  await assertStaff();
  if (!(amountCents > 0)) return { ok: false, error: "Nothing to charge." };
  try {
    await assertReader(readerId);
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: { source: "pos", reader_id: readerId },
    });
    return { ok: true, paymentIntentId: paymentIntent.id };
  } catch (e) {
    return { ok: false, error: chargeError(e) };
  }
}

// Step 2: show it on the reader. tipEligibleCents: the pre-tax amount the
// reader's suggested tip percentages are based on, or null to skip the tip
// screen (a tab already asked for its tip on the register). If the reader
// won't take it, the payment is canceled; canceled says whether that took
// (if not, the register keeps it to look up again).
export async function sendReaderPayment(
  paymentIntentId: string,
  readerId: string,
  tipEligibleCents: number | null,
): Promise<{ ok: true } | { ok: false; error: string; canceled: boolean }> {
  await assertStaff();
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return { ok: false, error: "That isn't a card payment.", canceled: false };
  const stripe = getStripe();
  try {
    await stripe.terminal.readers.processPaymentIntent(readerId, {
      payment_intent: paymentIntentId,
      // Stripe errors if a tip-eligible amount is sent while skipping tips.
      process_config: tipEligibleCents && tipEligibleCents > 0 ? { tipping: { amount_eligible: tipEligibleCents } } : { skip_tipping: true },
    });
    return { ok: true };
  } catch (e) {
    const canceled = await stripe.paymentIntents.cancel(paymentIntentId).then(
      () => true,
      () => false,
    );
    return { ok: false, error: chargeError(e), canceled };
  }
}

// Once it succeeds, `amount` includes any tip picked on the reader, and the
// tip itself is in amount_details.tip.amount.
export async function checkReaderPayment(paymentIntentId: string): Promise<{ status: string; errorMessage: string | null; amountCents: number; tipCents: number }> {
  await assertStaff();
  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return {
    status: paymentIntent.status,
    errorMessage: paymentIntent.last_payment_error?.message ?? null,
    amountCents: paymentIntent.amount,
    tipCents: paymentIntent.amount_details?.tip?.amount ?? 0,
  };
}

// Also used when the register reloads mid-payment and finds this payment
// still open, by which time the reader may have moved on to the next sale:
// its screen is only cleared while it's still showing this payment.
export async function cancelReaderPayment(paymentIntentId: string, readerId: string): Promise<void> {
  await assertStaff();
  const stripe = getStripe();
  if (readerId) {
    // No answer about the reader: clear it anyway, as before.
    const reader = await stripe.terminal.readers.retrieve(readerId).catch(() => null);
    const action = reader && !("deleted" in reader && reader.deleted) ? reader.action : null;
    const pi = action?.type === "process_payment_intent" ? action.process_payment_intent?.payment_intent : null;
    const showing = typeof pi === "string" ? pi : (pi?.id ?? null);
    if (!reader || showing === paymentIntentId) await stripe.terminal.readers.cancelAction(readerId).catch(() => {});
  }
  await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {});
}

// ---------- tip on the reader, for a tab's card on file ----------
// Charging a tab's saved card has no tap, so the reader never shows its own
// tip screen. Instead the reader asks with an on-screen question (Stripe's
// collect_inputs): 15/20/25% of the pre-tax tab total or "Other amount"
// (then a number pad, whole dollars), with "No tip" as the skip button
// (Stripe allows 4 choices). The register
// polls readTipAnswer, then charges the card on file with the tip.

export type TipChoice = "p15" | "p20" | "p25" | "other" | "none";

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function askTipOnReader(readerId: string, tipBaseCents: number, dueCents: number): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertStaff();
  if (!(tipBaseCents >= 0) || !(dueCents > 0) || !Number.isFinite(tipBaseCents) || !Number.isFinite(dueCents)) return { ok: false, error: "Nothing to charge." };
  try {
    await assertReader(readerId);
    const pct = (p: number) => Math.round(tipBaseCents * p);
    await getStripe().terminal.readers.collectInputs(readerId, {
      inputs: [
        {
          type: "selection",
          // Stripe allows 4 choices, so "No tip" is the skip button.
          required: false,
          custom_text: { title: "Add a tip?", description: `Your tab: ${dollars(dueCents)}\nPaying with the card on file.`, skip_button: "No tip" },
          selection: {
            choices: [
              { id: "p15", style: "primary", text: `15% · ${dollars(pct(0.15))}` },
              { id: "p20", style: "primary", text: `20% · ${dollars(pct(0.2))}` },
              { id: "p25", style: "primary", text: `25% · ${dollars(pct(0.25))}` },
              { id: "other", style: "secondary", text: "Other amount" },
            ],
          },
        },
      ],
      metadata: { purpose: "tab_tip" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: readerError(e) };
  }
}

export async function askCustomTipOnReader(readerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertStaff();
  try {
    await assertReader(readerId);
    await getStripe().terminal.readers.collectInputs(readerId, {
      inputs: [
        {
          type: "numeric",
          required: true,
          custom_text: { title: "Tip amount", description: "Whole dollars, e.g. 5", submit_button: "Add tip" },
        },
      ],
      metadata: { purpose: "tab_tip_custom" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: readerError(e) };
  }
}

// What the customer picked, once they have. "waiting" until then.
export async function readTipAnswer(
  readerId: string,
): Promise<{ status: "waiting" } | { status: "failed"; message: string } | { status: "done"; choice: TipChoice | null; numeric: string | null }> {
  await assertStaff();
  try {
    const reader = await getStripe().terminal.readers.retrieve(readerId);
    if ("deleted" in reader && reader.deleted) return { status: "failed", message: "That card reader isn't registered anymore." };
    const action = reader.action;
    if (!action || action.type !== "collect_inputs") return { status: "failed", message: "The reader moved on before the customer answered." };
    if (action.status === "in_progress") return { status: "waiting" };
    if (action.status === "failed") return { status: "failed", message: action.failure_message || "The reader stopped waiting (no answer for 2 minutes)." };
    const input = action.collect_inputs?.inputs?.[0];
    if (input?.skipped) return { status: "done", choice: "none", numeric: null };
    const id = input?.selection?.id ?? null;
    const choice = id && ["p15", "p20", "p25", "other", "none"].includes(id) ? (id as TipChoice) : null;
    const numeric = input?.numeric?.value ?? null;
    return { status: "done", choice, numeric };
  } catch (e) {
    return { status: "failed", message: readerError(e) };
  }
}

export async function cancelReaderQuestion(readerId: string): Promise<void> {
  await assertStaff();
  if (readerId) await getStripe().terminal.readers.cancelAction(readerId).catch(() => {});
}

function readerError(e: unknown): string {
  if (e instanceof UserFacingError) return e.message;
  const m = e && typeof e === "object" && "message" in e && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : null;
  return m ?? "Couldn't reach the card reader. Check that it's on and connected to Wi-Fi.";
}
