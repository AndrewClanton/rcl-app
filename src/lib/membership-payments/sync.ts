import "server-only";
import { cache } from "react";
import { after } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { insidersPlusPriceId } from "@/lib/member-rate";
import type { GiftLike, InvoiceLike, PlusContext, SubscriptionLike } from "./rows";
import { FRESH_SECONDS, errorMessage, loadPlusContext, lockedSync, recordEnd, recordGift, recordInvoice, supabaseStore, syncRunning, type Engine, type SyncMode, type SyncResult } from "./engine";
import { allowTestPayments, paymentsSyncAllowed, stripeKeyMode } from "./mode";

export type { SyncMode, SyncResult } from "./engine";

// Keeps member_payments in step with Stripe (the steps are in ./engine.ts).
// Runs:
//   - at the start of the daily-report cron (mode "daily": the last 45 days,
//     so a renewal that failed and was paid days later is still caught);
//   - when a Reports page opens and the last read is over 10 minutes old
//     (mode "quick": from a little before the last read);
//   - from the webhook, for a first payment, a gift and an ended
//     subscription, as they happen;
//   - "Re-read from Stripe" on Reports -> Members (mode "backfill": from
//     launch), and scripts/backfill-member-payments.mjs.
// Never throws: a failure is logged and returned, and the page or the email
// goes on without it.
//
// Only with the live Stripe key (./mode.ts): .env.local on a laptop has a
// test key but the real database, and test payments must never land in the
// real reports. (With MEMBER_PAYMENTS_ALLOW_TEST=1 and the test key, reads
// run but leave the shared "last read" row alone, and Reports pages don't
// start them: see lockedSync's `shared`.)

const PAGE_WAIT_MS = 2500; // a Reports page waits this long for a read, then goes on

// The sync's own Stripe client: a request that hangs gives up after 10 s
// and is tried once more (the library's default is 80 s, tried 3 times),
// so a read can't hold up the daily email or outlive its claim.
let stripeClient: { key: string; stripe: Stripe } | null = null;
function syncStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (stripeClient?.key !== key) stripeClient = { key, stripe: new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 }) };
  return stripeClient.stripe;
}

// The Insiders+ product and its prices, read once an hour per server (a
// price met since is looked up then: engine.ts learnPrices).
let ctxCache: { at: number; ctx: PlusContext } | null = null;

async function engine(): Promise<Engine> {
  const stripe = syncStripe();
  if (!ctxCache || Date.now() - ctxCache.at > 3_600_000) {
    const ctx = await loadPlusContext(stripe, { adult: insidersPlusPriceId("adult"), senior: insidersPlusPriceId("senior"), student: insidersPlusPriceId("student") });
    ctxCache = { at: Date.now(), ctx };
  }
  return { stripe, store: supabaseStore(createAdminClient()), ctx: ctxCache.ctx, allowTest: allowTestPayments() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `deadline` (epoch ms): start no Stripe call after this (the cron passes
// its own, so a read still going after the email has gone out stops before
// the function is ended).
export async function syncMemberPayments(opts: { mode: SyncMode; since?: string; force?: boolean; deadline?: number }): Promise<SyncResult> {
  if (!paymentsSyncAllowed()) {
    return { ok: true, mode: opts.mode, ms: 0, skipped: stripeKeyMode() === "none" ? "no Stripe key" : "test Stripe key (live payments are only read with the live key)" };
  }
  try {
    return await lockedSync(createAdminClient(), engine, { ...opts, shared: stripeKeyMode() === "live" });
  } catch (e) {
    // lockedSync doesn't throw; this is only if the database client can't be made.
    return { ok: false, mode: opts.mode, ms: 0, error: errorMessage(e) };
  }
}

// For a Reports page, before it reads its numbers: if Stripe was last read
// over 10 minutes ago, read it again, waiting up to 2.5 seconds; a longer
// read finishes after the page has gone out (after(), so the server keeps
// running it), and the next load has it. Once per request, never throws.
// Live key only (a test-key read never marks when it ran, so it would run
// on every page load).
export const ensureMemberPaymentsFresh = cache(async (): Promise<void> => {
  if (stripeKeyMode() !== "live") return;
  try {
    const { data, error } = await createAdminClient().from("member_payment_sync").select("started_at, finished_at").maybeSingle();
    if (error || !data) return; // not set up yet
    const last = data.finished_at ? new Date(data.finished_at).getTime() : 0;
    if (Date.now() - last < FRESH_SECONDS * 1000 || syncRunning(data)) return;
    const run = syncMemberPayments({ mode: "quick" });
    const finished = await Promise.race([run.then(() => true), sleep(PAGE_WAIT_MS).then(() => false)]);
    if (!finished) {
      after(async () => {
        await run;
      });
    }
  } catch (e) {
    console.warn("member payments: freshness check failed:", errorMessage(e));
  }
});

// ---------- as it happens (the Stripe webhook, the welcome redirect) ----------
// Each is best effort, run after the answer has gone back (after()): the
// sync picks up anything missed here.

// A new Insiders+ membership's first charge, once its checkout completes
// (none yet when a card was saved for a later first charge: that invoice is
// $0 and skipped).
export async function recordCheckoutPayment(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "subscription" || !paymentsSyncAllowed()) return;
  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  if (!invoiceId) return;
  try {
    const e = await engine();
    const invoice = await e.stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
    await recordInvoice(e, invoice as unknown as InvoiceLike);
  } catch (err) {
    console.warn("member payments: first payment not recorded (the next read will):", errorMessage(err));
  }
}

// The first charge of an Insiders+ subscription made at the register (a
// former unlimited member's card on the reader, pos/legacy-plus-actions.ts):
// there's no checkout session, just its first invoice.
export async function recordInvoicePayment(invoiceId: string): Promise<void> {
  if (!paymentsSyncAllowed() || !invoiceId) return;
  try {
    const e = await engine();
    const invoice = await e.stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
    await recordInvoice(e, invoice as unknown as InvoiceLike);
  } catch (err) {
    console.warn("member payments: first payment not recorded (the next read will):", errorMessage(err));
  }
}

// A gift membership, once it's paid (lib/gift-membership.ts).
export async function recordGiftPayment(giftId: string): Promise<void> {
  if (!paymentsSyncAllowed()) return;
  try {
    const { data } = await createAdminClient()
      .from("gift_memberships")
      .select("id, recipient_member_id, price, tax_amount, paid_at, starts_at, ends_at, stripe_payment_intent_id, stripe_checkout_session_id, status")
      .eq("id", giftId)
      .maybeSingle();
    if (!data || data.status !== "paid" || !data.paid_at) return;
    await recordGift(await engine(), data as GiftLike);
  } catch (err) {
    console.warn("member payments: gift not recorded (the next read will):", errorMessage(err));
  }
}

// An Insiders+ subscription that ended.
export async function recordSubscriptionEnd(subscription: Stripe.Subscription): Promise<void> {
  if (!paymentsSyncAllowed()) return;
  try {
    await recordEnd(await engine(), subscription as unknown as SubscriptionLike);
  } catch (err) {
    console.warn("member payments: ended subscription not recorded (the next read will):", errorMessage(err));
  }
}
