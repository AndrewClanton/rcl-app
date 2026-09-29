"use server";

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

// A card on file for a bar tab. When the tab opens, the customer taps their
// card on the reader and Stripe saves it -- nothing is charged. When the tab
// closes, the final total (tip included) is charged to that card without a
// second tap, and the card is taken off file (lib/tab-card.ts).
//
// Like the reader charges, these return errors rather than throw, so staff
// see the real reason ("reader offline", "card declined").

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function stripeMessage(e: unknown, fallback: string) {
  return e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string" && "type" in e ? (e as { message: string }).message : fallback;
}

function cardLabel(brand: string | null | undefined, last4: string | null | undefined) {
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
  return last4 ? `${name} ••${last4}` : name;
}

async function openTab(tabId: string) {
  const { data } = await createAdminClient().from("orders").select("id, order_name, status, tab_card_customer_id, tab_card_payment_method_id, tab_card_label").eq("id", tabId).maybeSingle();
  return data && data.status === "tab" ? data : null;
}

// Step 1: send "save this card" to the reader.
export async function startTabCard(tabId: string, readerId: string): Promise<Result<{ setupIntentId: string }>> {
  await assertStaff();
  if (!readerId) return { ok: false, error: "No card reader is chosen for this register. Pick one under Devices." };
  const tab = await openTab(tabId);
  if (!tab) return { ok: false, error: "That tab isn't open anymore." };
  const stripe = getStripe();
  try {
    let customerId = tab.tab_card_customer_id;
    if (!customerId) {
      customerId = (await stripe.customers.create({ name: tab.order_name ? `Tab: ${tab.order_name}` : "Bar tab", metadata: { source: "pos-tab", tab_id: tabId } })).id;
      await createAdminClient().from("orders").update({ tab_card_customer_id: customerId }).eq("id", tabId);
    }
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card_present"],
      usage: "off_session",
      metadata: { source: "pos-tab", tab_id: tabId },
    });
    try {
      // "limited": the customer agreed to keep it on file for this tab, not
      // to have it offered back to them later.
      await stripe.terminal.readers.processSetupIntent(readerId, { setup_intent: setupIntent.id, allow_redisplay: "limited" });
    } catch (e) {
      await stripe.setupIntents.cancel(setupIntent.id).catch(() => {});
      throw e;
    }
    return { ok: true, setupIntentId: setupIntent.id };
  } catch (e) {
    return { ok: false, error: stripeMessage(e, "Couldn't reach the card reader. Check that it's on and connected to Wi-Fi.") };
  }
}

// Step 2 (polled): has the customer tapped yet? Saves the card on the tab when they have.
export async function checkTabCard(setupIntentId: string, tabId: string): Promise<{ status: "waiting" | "saved" | "failed"; label?: string; message?: string }> {
  await assertStaff();
  const stripe = getStripe();
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["latest_attempt"] });
  if (si.status === "succeeded") {
    const attempt = si.latest_attempt as Stripe.SetupAttempt | null;
    const present = attempt?.payment_method_details?.card_present;
    const generated = present?.generated_card;
    const paymentMethodId = typeof generated === "string" ? generated : generated?.id;
    if (!paymentMethodId) return { status: "failed", message: "That card can't be kept on file (phone and watch wallets usually can't). Try a physical card, or skip it." };
    const card = await stripe.paymentMethods
      .retrieve(paymentMethodId)
      .then((pm) => pm.card)
      .catch(() => null);
    const label = cardLabel(card?.brand, card?.last4);
    await createAdminClient().from("orders").update({ tab_card_payment_method_id: paymentMethodId, tab_card_label: label }).eq("id", tabId);
    revalidatePath("/pos");
    return { status: "saved", label };
  }
  if (si.status === "canceled") return { status: "failed", message: "Cancelled on the reader." };
  return { status: "waiting", message: si.last_setup_error?.message ?? undefined };
}

export async function cancelTabCard(setupIntentId: string, readerId: string): Promise<void> {
  await assertStaff();
  const stripe = getStripe();
  if (readerId) await stripe.terminal.readers.cancelAction(readerId).catch(() => {});
  await stripe.setupIntents.cancel(setupIntentId).catch(() => {});
}

// Closing the tab: charge the saved card for the total (tip included).
export async function chargeTabCard(tabId: string, amountCents: number): Promise<Result<{ paymentIntentId: string; amountCents: number }>> {
  await assertStaff();
  if (!(amountCents > 0)) return { ok: false, error: "Nothing to charge." };
  const tab = await openTab(tabId);
  if (!tab?.tab_card_payment_method_id || !tab.tab_card_customer_id) return { ok: false, error: "This tab doesn't have a card on file." };
  try {
    const pi = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: tab.tab_card_customer_id,
      payment_method: tab.tab_card_payment_method_id,
      payment_method_types: ["card"],
      off_session: true,
      confirm: true,
      metadata: { source: "pos-tab", tab_id: tabId },
    });
    if (pi.status !== "succeeded") return { ok: false, error: "The card on file didn't go through. Ask for another way to pay." };
    return { ok: true, paymentIntentId: pi.id, amountCents: pi.amount_received };
  } catch (e) {
    return { ok: false, error: `${stripeMessage(e, "The card on file was declined.")} Ask for another way to pay.` };
  }
}
