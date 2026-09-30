import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LAUNCH,
  endRow,
  giftRow,
  paymentStatus,
  priceInfo,
  readPlusInvoice,
  refundPaymentIntent,
  refundRow,
  refundTaxCents,
  unknownPlusPrices,
  type EndRow,
  type GiftLike,
  type InvoiceLike,
  type PaymentRow,
  type PlusContext,
  type StoredPayment,
  type SubscriptionLike,
  type Tier,
} from "./rows";

// Reading member payments from Stripe into member_payments: the steps, with
// Stripe and the database handed in, so the app (./sync.ts) and
// scripts/backfill-member-payments.mjs run exactly the same code. Stripe is
// only read (lists and retrieves), never changed.
//
// Safe to run again and at the same time as another run: every row is keyed
// by the Stripe id it came from (source_id is unique), a row that's already
// there is only brought up to date, and a new one that another run saved
// first is skipped. A row's kind (new, renewal, ...) is decided once, when
// it's first saved. Runs of the whole sync also take turns (lockedSync).

// Only type imports above (and the rules module, ./rows): Node runs this
// file directly for the backfill script.

// ---------- the database, as the sync needs it ----------

export interface MemberLink {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export interface PaymentStore {
  existing(sourceIds: string[]): Promise<StoredPayment[]>;
  // Saved payments (not refunds) made with these payment intents.
  byPaymentIntent(ids: string[]): Promise<StoredPayment[]>;
  // Whether an Insiders+ charge on this subscription was saved before `beforeIso`.
  hasEarlierPlus(subscriptionId: string, beforeIso: string): Promise<boolean>;
  members(customerIds: string[], subscriptionIds: string[]): Promise<MemberLink[]>;
  paidGifts(sinceIso: string): Promise<GiftLike[]>;
  // New rows; one already saved (by another run) is left as it is. Returns how many were added.
  insert(rows: PaymentRow[]): Promise<number>;
  update(id: string, patch: Partial<PaymentRow>): Promise<void>;
  // Refund rows only. Returns how many went.
  removeRefunds(sourceIds: string[]): Promise<number>;
  // Saved refund rows of these payments (amounts negative, as saved).
  refundsOf(paymentIds: string[]): Promise<SavedRefund[]>;
  saveEnds(rows: EndRow[]): Promise<number>;
}

export interface SavedRefund {
  refund_of: string;
  source_id: string;
  amount_cents: number;
  tax_cents: number;
}

export interface Engine {
  stripe: Stripe;
  store: PaymentStore;
  ctx: PlusContext;
  // Keep test-mode payments too (normally only live ones are saved).
  allowTest: boolean;
  // Epoch ms: no Stripe call starts after this (the run stops with an
  // error and the next one picks up), so a run never outlives its claim.
  deadline?: number;
}

// Stops a run that's out of time before it asks Stripe for more.
function inTime(e: Engine) {
  if (e.deadline !== undefined && Date.now() > e.deadline) throw new Error("out of time reading Stripe; the next read picks up the rest");
}

export interface SyncCounts {
  invoices: number; // paid invoices looked at
  latePaid: number; // of them, made before the read's window but paid in it (found by their invoice.paid event)
  plus: Tally;
  gifts: Tally;
  refunds: Tally & { removed: number };
  ends: number;
  skipped: { nothingCharged: number; testMode: number };
  warnings: string[];
}

interface Tally {
  added: number;
  updated: number;
}

export function emptyCounts(): SyncCounts {
  return { invoices: 0, latePaid: 0, plus: { added: 0, updated: 0 }, gifts: { added: 0, updated: 0 }, refunds: { added: 0, updated: 0, removed: 0 }, ends: 0, skipped: { nothingCharged: 0, testMode: 0 }, warnings: [] };
}

const unixOf = (isoString: string) => Math.floor(new Date(isoString).getTime() / 1000);
const isoOf = (unix: number) => new Date(unix * 1000).toISOString();
const unique = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];

// ---------- the Insiders+ product and its prices ----------

// The product (from the adult monthly price the site is set up with) and
// every price on it, old and inactive ones too.
export async function loadPlusContext(stripe: Stripe, monthlyIds: Partial<Record<Tier, string>>): Promise<PlusContext> {
  let productId: string | null = null;
  const adult = monthlyIds.adult ?? monthlyIds.senior ?? monthlyIds.student;
  if (adult) {
    const price = await stripe.prices.retrieve(adult);
    productId = typeof price.product === "string" ? price.product : price.product.id;
  } else {
    productId = (await stripe.products.search({ query: 'name:"Royale Insiders+"', limit: 1 })).data[0]?.id ?? null;
  }
  const prices = new Map<string, ReturnType<typeof priceInfo>>();
  if (productId) {
    for await (const p of stripe.prices.list({ product: productId, limit: 100 })) prices.set(p.id, priceInfo(p, monthlyIds));
  }
  return { productId, prices, monthlyIds };
}

// ---------- one run ----------

const warn = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Everything from `fromIso` on: paid Insiders+ invoices, paid gifts,
// refunds of either, and subscriptions that ended. `latePaid`: also the
// invoices made before `fromIso` but paid since (a renewal whose card was
// declined and went through days later), found by their invoice.paid events.
export async function runPaymentSync(e: Engine, fromIso: string, opts: { latePaid?: boolean } = {}): Promise<SyncCounts> {
  const counts = emptyCounts();
  const from = unixOf(fromIso < LAUNCH ? LAUNCH : fromIso);

  // Stripe is read all at once (a Reports page waits on this) while the
  // gifts are saved: they're in the database already, so a Stripe failure
  // never holds them back.
  const reads = Promise.all([
    listAll(e, e.stripe.invoices.list({ status: "paid", created: { gte: from }, limit: 100, expand: ["data.payments"] })),
    // Every refund on the account (tickets and the register too); only the
    // ones on a membership payment are kept.
    listAll(e, e.stripe.refunds.list({ created: { gte: from }, limit: 100 })),
    // Stripe keeps events for 30 days; the daily run reads every day. Best
    // effort: the payments stand without it.
    listAll(e, e.stripe.events.list({ type: "customer.subscription.deleted", created: { gte: from }, limit: 100 })).catch((err: unknown) => {
      counts.warnings.push(`ended subscriptions not read: ${warn(err)}`);
      return [] as Stripe.Event[];
    }),
    opts.latePaid
      ? listAll(e, e.stripe.events.list({ type: "invoice.paid", created: { gte: from }, limit: 100 })).catch((err: unknown) => {
          counts.warnings.push(`invoices paid late not looked for: ${warn(err)}`);
          return [] as Stripe.Event[];
        })
      : Promise.resolve([] as Stripe.Event[]),
  ]);
  // Awaited below; this only stops Node calling a failure "unhandled" while
  // the gifts are being saved.
  reads.catch(() => undefined);

  // 1. Gift memberships (the database already has them).
  const giftRows: PaymentRow[] = [];
  for (const g of await e.store.paidGifts(isoOf(from))) {
    const row = giftRow(g);
    if (!row.livemode && !e.allowTest) counts.skipped.testMode++;
    else giftRows.push(row);
  }
  await saveRows(e, giftRows, counts.gifts);

  const [listed, refunds, ended, paidEvents] = await reads;

  // 2. Insiders+ charges: the invoices made in the window, and any made
  // before it that were paid in it.
  const invoices = listed as unknown as InvoiceLike[];
  const known = new Set(invoices.map((i) => i.id));
  for (const ev of paidEvents) {
    const obj = ev.data.object as { id?: string; created?: number };
    if (!obj.id || known.has(obj.id) || (obj.created ?? 0) >= from) continue;
    known.add(obj.id);
    inTime(e);
    invoices.push((await e.stripe.invoices.retrieve(obj.id, { expand: ["payments"] })) as unknown as InvoiceLike);
    counts.latePaid++;
  }
  counts.invoices = invoices.length;
  const plusRows = await saveInvoices(e, invoices, counts);

  // 3. Refunds of any of them.
  await saveRefunds(e, refunds, [...plusRows, ...giftRows], counts);

  // 4. Subscriptions that ended.
  const ends: EndRow[] = [];
  for (const ev of ended) {
    const row = endRow(ev.data.object as unknown as SubscriptionLike, e.ctx);
    if (row && (row.livemode || e.allowTest)) ends.push(row);
  }
  counts.ends += await saveEnds(e, ends);
  return counts;
}

async function listAll<T>(e: Engine, list: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of list) {
    out.push(x);
    if (out.length % 100 === 0) inTime(e); // before the next page
  }
  return out;
}

// Insiders+ prices on these invoices that the context doesn't know (a
// yearly price made since the prices were read), looked up and added, so
// the plan is right on the first read. Best effort.
async function learnPrices(e: Engine, invoices: InvoiceLike[], counts: SyncCounts) {
  const ids = unique(invoices.flatMap((inv) => unknownPlusPrices(inv, e.ctx)));
  for (const id of ids) {
    inTime(e);
    try {
      e.ctx.prices.set(id, priceInfo(await e.stripe.prices.retrieve(id), e.ctx.monthlyIds ?? {}));
    } catch (err) {
      counts.warnings.push(`price ${id} not read: ${warn(err)}`);
    }
  }
}

// Paid invoices -> saved Insiders+ rows (the ones that are Insiders+ and
// charged something). Returns the rows, new and already saved.
export async function saveInvoices(e: Engine, invoices: InvoiceLike[], counts: SyncCounts): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  await learnPrices(e, invoices, counts);
  for (const inv of invoices) {
    const r = readPlusInvoice(inv, e.ctx);
    if ("skip" in r) {
      if (r.skip === "nothing_charged") counts.skipped.nothingCharged++;
      continue;
    }
    if (!r.row.livemode && !e.allowTest) {
      counts.skipped.testMode++;
      continue;
    }
    rows.push(r.row);
  }
  await saveRows(e, rows, counts.plus, (row, all) => classify(e, row, all));
  return rows;
}

// New, or what readPlusInvoice made it (a renewal, a switch, a plan
// change): was there a charge on the same subscription before this one?
// This run's own rows first, then the saved ones, then Stripe.
async function classify(e: Engine, row: PaymentRow, all: PaymentRow[]) {
  if (row.product !== "plus" || row.kind === "plus_new") return;
  const sub = row.stripe_subscription_id;
  let earlier = !!sub && all.some((o) => o !== row && o.product === "plus" && o.stripe_subscription_id === sub && o.paid_at < row.paid_at);
  if (!earlier && sub) earlier = await e.store.hasEarlierPlus(sub, row.paid_at);
  if (!earlier && sub) {
    inTime(e);
    const before = unixOf(row.paid_at);
    for await (const inv of e.stripe.invoices.list({ subscription: sub, status: "paid", limit: 100 })) {
      const paidAt = inv.status_transitions?.paid_at ?? inv.created;
      if (inv.id !== row.stripe_invoice_id && inv.amount_paid > 0 && paidAt < before) {
        earlier = true;
        break;
      }
    }
  }
  if (!earlier) row.kind = "plus_new";
}

// What an already-saved row takes from a fresh read. Its kind stays.
function changes(saved: StoredPayment, row: PaymentRow): Partial<PaymentRow> | null {
  const patch: Partial<PaymentRow> = {};
  for (const k of ["amount_cents", "sales_cents", "tax_cents", "tier", "billing_interval", "period_start", "period_end", "stripe_payment_intent_id", "stripe_credit_note_id"] as const) {
    const now = row[k];
    if (now !== null && now !== undefined && !same(saved[k], now)) (patch as Record<string, unknown>)[k] = now;
  }
  if (!saved.member_id && row.member_id) patch.member_id = row.member_id;
  if (row.kind === "refund" && row.refund_of && saved.refund_of !== row.refund_of) patch.refund_of = row.refund_of;
  return Object.keys(patch).length ? patch : null;
}

function same(a: unknown, b: unknown) {
  if (typeof a === "string" && typeof b === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(b)) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}

// Saves rows: members linked, new ones classified (in the order they were
// paid) and added, saved ones brought up to date.
async function saveRows(e: Engine, rows: PaymentRow[], tally: Tally, classifyNew?: (row: PaymentRow, all: PaymentRow[]) => Promise<void>) {
  if (!rows.length) return;
  rows.sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.source_id.localeCompare(b.source_id));
  await linkMembers(e, rows);
  const saved = new Map((await e.store.existing(rows.map((r) => r.source_id))).map((s) => [s.source_id, s]));
  const fresh: PaymentRow[] = [];
  for (const row of rows) {
    const was = saved.get(row.source_id);
    if (!was) {
      if (classifyNew) await classifyNew(row, rows);
      fresh.push(row);
      continue;
    }
    row.kind = was.kind;
    const patch = changes(was, row);
    if (patch) {
      await e.store.update(was.id, patch);
      tally.updated++;
    }
  }
  if (fresh.length) tally.added += await e.store.insert(fresh);
}

async function linkMembers(e: Engine, rows: { member_id: string | null; stripe_customer_id: string | null; stripe_subscription_id?: string | null }[]) {
  const need = rows.filter((r) => !r.member_id && (r.stripe_customer_id || r.stripe_subscription_id));
  if (!need.length) return;
  const found = await e.store.members(unique(need.map((r) => r.stripe_customer_id)), unique(need.map((r) => r.stripe_subscription_id)));
  const byCustomer = new Map(found.filter((m) => m.stripe_customer_id).map((m) => [m.stripe_customer_id as string, m.id]));
  const bySubscription = new Map(found.filter((m) => m.stripe_subscription_id).map((m) => [m.stripe_subscription_id as string, m.id]));
  for (const r of need) r.member_id = (r.stripe_customer_id && byCustomer.get(r.stripe_customer_id)) || (r.stripe_subscription_id && bySubscription.get(r.stripe_subscription_id)) || null;
}

// ---------- refunds ----------

async function saveRefunds(e: Engine, refunds: Stripe.Refund[], justRead: PaymentRow[], counts: SyncCounts) {
  const intents = unique(refunds.map((re) => refundPaymentIntent(re)));
  if (!intents.length) return;

  // Saved payments (with their ids), else this run's rows (a dry run saves nothing).
  const payments = new Map<string, PaymentRow & { id?: string }>();
  for (const r of justRead) if (r.stripe_payment_intent_id) payments.set(r.stripe_payment_intent_id, r);
  for (const s of await e.store.byPaymentIntent(intents)) if (s.stripe_payment_intent_id) payments.set(s.stripe_payment_intent_id, s);

  // Ours only (on a membership payment), oldest first: each one's tax is
  // worked out on the running total of what its payment has had back.
  const ours = refunds
    .filter((re) => {
      const pi = refundPaymentIntent(re);
      return !!pi && payments.has(pi);
    })
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  if (!ours.length) return;

  // What each payment already had back from refunds before this read's
  // window (saved, and not read again now), as positive cents.
  const listed = new Set(ours.map((re) => re.id));
  const piOfPayment = new Map<string, string>();
  for (const [pi, p] of payments) if (p.id) piOfPayment.set(p.id, pi);
  const given = new Map<string, { amount: number; tax: number }>(); // payment intent -> back so far
  for (const s of piOfPayment.size ? await e.store.refundsOf([...piOfPayment.keys()]) : []) {
    const pi = piOfPayment.get(s.refund_of);
    if (!pi || listed.has(s.source_id)) continue;
    const g = given.get(pi) ?? { amount: 0, tax: 0 };
    given.set(pi, { amount: g.amount - s.amount_cents, tax: g.tax - s.tax_cents });
  }

  const rows: PaymentRow[] = [];
  const gone: string[] = [];
  const touched = new Map<string, PaymentRow & { id?: string }>();
  for (const re of ours) {
    const pi = refundPaymentIntent(re) as string;
    const payment = payments.get(pi) as PaymentRow & { id?: string };
    if (payment.id) touched.set(payment.id, payment);
    if (re.status === "failed" || re.status === "canceled") {
      gone.push(re.id);
      continue;
    }
    if (re.status !== "succeeded") continue; // pending: counted once it goes through
    inTime(e);
    const before = given.get(pi) ?? { amount: 0, tax: 0 };
    const note = payment.stripe_invoice_id ? await creditNoteTax(e.stripe, payment.stripe_invoice_id, re) : null;
    const tax = note?.tax ?? refundTaxCents(re.amount, payment, before);
    rows.push(refundRow(re, payment, tax, note?.id ?? null));
    given.set(pi, { amount: before.amount + re.amount, tax: before.tax + tax });
  }
  await saveRows(e, rows, counts.refunds);
  if (gone.length) counts.refunds.removed += await e.store.removeRefunds(gone);

  // Each payment's status: paid, partly refunded, refunded.
  if (!touched.size) return;
  const back = new Map<string, number>();
  for (const r of await e.store.refundsOf([...touched.keys()])) back.set(r.refund_of, (back.get(r.refund_of) ?? 0) - r.amount_cents);
  for (const [id, p] of touched) {
    const status = paymentStatus(p.amount_cents, back.get(id) ?? 0);
    if (status !== p.status) await e.store.update(id, { status });
  }
}

// The tax a credit note says a refund gave back (Stripe makes one when an
// invoice is refunded from the dashboard), or null when there isn't one.
async function creditNoteTax(stripe: Stripe, invoiceId: string, re: Stripe.Refund): Promise<{ id: string; tax: number } | null> {
  for await (const note of stripe.creditNotes.list({ invoice: invoiceId, limit: 100 })) {
    const part = note.refunds?.find((r) => (typeof r.refund === "string" ? r.refund : r.refund?.id) === re.id);
    if (!part) continue;
    const tax = (note.total_taxes ?? []).reduce((s, t) => s + t.amount, 0);
    // A note that also credited the balance: this refund's share of its tax.
    return { id: note.id, tax: note.total > 0 && note.total !== re.amount ? Math.round((tax * re.amount) / note.total) : tax };
  }
  return null;
}

// ---------- subscriptions that ended ----------

async function saveEnds(e: Engine, rows: EndRow[]): Promise<number> {
  if (!rows.length) return 0;
  await linkMembers(e, rows);
  return e.store.saveEnds(rows);
}

// ---------- recording one as it happens (the webhook) ----------

export async function recordInvoice(e: Engine, invoice: InvoiceLike): Promise<SyncCounts> {
  const counts = emptyCounts();
  await saveInvoices(e, [invoice], counts);
  return counts;
}

export async function recordGift(e: Engine, gift: GiftLike): Promise<SyncCounts> {
  const counts = emptyCounts();
  const row = giftRow(gift);
  if (row.livemode || e.allowTest) await saveRows(e, [row], counts.gifts);
  return counts;
}

export async function recordEnd(e: Engine, sub: SubscriptionLike): Promise<number> {
  const row = endRow(sub, e.ctx);
  return row && (row.livemode || e.allowTest) ? saveEnds(e, [row]) : 0;
}

// ---------- a whole run, one at a time ----------
// The sync's state is one row (member_payment_sync): a run claims it first
// (claim_member_payment_sync), so two page loads at the same moment start
// one read, not two, and a Reports page doesn't read again within 10
// minutes of the last read. The claim hands back a run id; only the run
// holding it writes the row afterwards, so a run that was taken to have died
// (and was taken over) can't release or overwrite the newer one's claim.

export type SyncMode = "quick" | "daily" | "backfill";

export interface SyncResult {
  ok: boolean;
  mode: SyncMode;
  skipped?: string;
  error?: string;
  from?: string; // read from (ISO)
  counts?: SyncCounts;
  ms: number;
}

export const FRESH_SECONDS = 10 * 60; // Reports read Stripe again after this long
export const LOCK_SECONDS = 120; // a run that started this long ago is taken to have died
// A run starts no Stripe call after this long, so with the app's Stripe
// client (10 s timeout, 1 retry) it's done well inside LOCK_SECONDS.
export const RUN_SECONDS = LOCK_SECONDS - 30;
const QUICK_OVERLAP_DAYS = 3; // quick: from this long before the last read
const DAILY_DAYS = 45; // daily: a renewal that failed and was paid weeks later is still caught
const DAILY_WAIT_TRIES = 4; // daily: waits up to 4 x 2.5 s behind a read already going
const DAILY_WAIT_MS = 2500;
const DAY_MS = 86_400_000;

const msOf = (at: string | null | undefined) => (at ? new Date(at).getTime() : 0);

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

// A read in progress: started, not finished since, and not so long ago that it must have died.
export function syncRunning(s: { started_at: string | null; finished_at: string | null }, now = Date.now()): boolean {
  return !!s.started_at && msOf(s.started_at) > msOf(s.finished_at) && now - msOf(s.started_at) < LOCK_SECONDS * 1000;
}

// Where a run starts reading (paid invoices, refunds and gifts made since):
//   quick     a little before the last read's mark
//   daily     the last 45 days
//   backfill  `since`, or launch
// The first read ever goes back to launch, whatever the mode.
export function syncFrom(mode: SyncMode, through: string | null, now: number, since?: string): string {
  const from =
    mode === "backfill"
      ? new Date(since ?? LAUNCH).toISOString()
      : mode === "daily"
        ? new Date(now - DAILY_DAYS * DAY_MS).toISOString()
        : new Date(msOf(through) - QUICK_OVERLAP_DAYS * DAY_MS).toISOString();
  return !through || from < LAUNCH ? LAUNCH : from;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LockedSyncOptions {
  mode: SyncMode;
  since?: string;
  // Read even if the last read was just now (still not while another run is
  // going; the daily one waits its turn, up to about 10 s).
  force?: boolean;
  // Epoch ms: start no Stripe call after this (the caller's own time limit;
  // the run's is RUN_SECONDS from its claim either way).
  deadline?: number;
  // False: leave member_payment_sync alone (no claim, no marks). For a run
  // with Stripe's test key: the real site's reads go by that row, and a
  // test run on a laptop pointed at the real database mustn't move it.
  shared?: boolean;
}

// One run: claim it, read Stripe, save, and mark when. Never throws: a
// failure is recorded (so the next try waits the usual 10 minutes, not
// forever) and returned.
export async function lockedSync(db: SupabaseClient, getEngine: () => Promise<Engine>, opts: LockedSyncOptions): Promise<SyncResult> {
  const t0 = Date.now();
  const done = (r: Omit<SyncResult, "mode" | "ms">): SyncResult => ({ mode: opts.mode, ms: Date.now() - t0, ...r });
  const deadline = (claimedAt: number) => Math.min(opts.deadline ?? Infinity, claimedAt + RUN_SECONDS * 1000);

  if (opts.shared === false) {
    try {
      const from = opts.since && new Date(opts.since).toISOString() > LAUNCH ? new Date(opts.since).toISOString() : LAUNCH;
      const counts = await runPaymentSync({ ...(await getEngine()), deadline: deadline(t0) }, from);
      return done({ ok: true, from, counts });
    } catch (e) {
      const error = errorMessage(e);
      console.error(`member payments: ${opts.mode} read from Stripe failed:`, error);
      return done({ ok: false, error });
    }
  }

  let runId: string | null = null;
  const state = () => db.from("member_payment_sync");
  try {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await db.rpc("claim_member_payment_sync", { p_fresh_seconds: opts.force ? 0 : FRESH_SECONDS, p_lock_seconds: LOCK_SECONDS });
      if (error) return done({ ok: false, skipped: "not set up (is migration 20261001110000_member_payments.sql applied?)", error: error.message });
      if (typeof data === "string" && data) {
        runId = data;
        break;
      }
      // Only the daily run waits (up to about 10 s) behind a run already
      // going, then counts on it if it finished meanwhile.
      if (opts.mode !== "daily" || attempt >= DAILY_WAIT_TRIES || (opts.deadline !== undefined && Date.now() + DAILY_WAIT_MS > opts.deadline)) {
        return done({ ok: true, skipped: "read recently, or a read is already going" });
      }
      await sleep(DAILY_WAIT_MS);
      const { data: s } = await state().select("started_at, finished_at").maybeSingle();
      if (s && msOf(s.finished_at) >= t0 && !syncRunning(s)) return done({ ok: true, skipped: "another read just finished" });
    }
    const claimedAt = Date.now();

    const { data: saved, error: stateErr } = await state().select("invoices_through").maybeSingle();
    if (stateErr) throw stateErr;
    const through = (saved?.invoices_through as string | null | undefined) ?? null;
    const from = syncFrom(opts.mode, through, t0, opts.since);

    // A quick read goes back 3 days by when invoices were made; one made
    // earlier and paid since is found by its invoice.paid event.
    const counts = await runPaymentSync({ ...(await getEngine()), deadline: deadline(claimedAt) }, from, { latePaid: opts.mode === "quick" });
    const now = new Date().toISOString();
    // Reads overlap; the mark never moves back.
    const mark = new Date(Math.max(t0, msOf(through))).toISOString();
    const { data: marked, error: saveErr } = await state()
      .update({ finished_at: now, succeeded_at: now, invoices_through: mark, refunds_through: mark, last_error: null, last_result: { mode: opts.mode, from, ms: Date.now() - t0, ...counts } })
      .eq("id", true)
      .eq("run_id", runId)
      .select("id");
    if (saveErr) console.warn("member payments: read saved, but not when:", saveErr.message);
    else if (!marked?.length) console.warn("member payments: read saved; a newer read had taken over, so its marks stand");
    return done({ ok: true, from, counts });
  } catch (e) {
    const error = errorMessage(e);
    console.error(`member payments: ${opts.mode} read from Stripe failed:`, error);
    if (runId) {
      // Only this run's own claim is released (a newer run's is left alone).
      await state()
        .update({ finished_at: new Date().toISOString(), started_at: null, last_error: error.slice(0, 500) })
        .eq("id", true)
        .eq("run_id", runId)
        .then(
          () => undefined,
          () => undefined,
        );
    }
    return done({ ok: false, error });
  }
}

// ---------- the database ----------

export const PAYMENT_COLUMNS =
  "id, source_id, kind, product, member_id, tier, billing_interval, amount_cents, sales_cents, tax_cents, paid_at, counted_at, business_date, status, billing_reason, period_start, period_end, stripe_invoice_id, stripe_subscription_id, stripe_customer_id, stripe_payment_intent_id, stripe_refund_id, stripe_credit_note_id, gift_membership_id, refund_of, livemode";

const CHUNK = 100;
function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function supabaseStore(db: SupabaseClient): PaymentStore {
  const table = () => db.from("member_payments");
  return {
    async existing(ids) {
      const out: StoredPayment[] = [];
      for (const c of chunks(unique(ids))) out.push(...must(await table().select(PAYMENT_COLUMNS).in("source_id", c)) as StoredPayment[]);
      return out;
    },
    async byPaymentIntent(ids) {
      const out: StoredPayment[] = [];
      for (const c of chunks(unique(ids))) out.push(...must(await table().select(PAYMENT_COLUMNS).in("stripe_payment_intent_id", c).neq("kind", "refund")) as StoredPayment[]);
      return out;
    },
    async hasEarlierPlus(subscriptionId, beforeIso) {
      const rows = must(await table().select("id").eq("stripe_subscription_id", subscriptionId).eq("product", "plus").neq("kind", "refund").lt("paid_at", beforeIso).limit(1));
      return rows.length > 0;
    },
    async members(customerIds, subscriptionIds) {
      const out: MemberLink[] = [];
      for (const c of chunks(customerIds)) out.push(...must(await db.from("members").select("id, stripe_customer_id, stripe_subscription_id").in("stripe_customer_id", c)) as MemberLink[]);
      for (const c of chunks(subscriptionIds)) out.push(...must(await db.from("members").select("id, stripe_customer_id, stripe_subscription_id").in("stripe_subscription_id", c)) as MemberLink[]);
      return out;
    },
    async paidGifts(sinceIso) {
      const out: GiftLike[] = [];
      for (let from = 0; ; from += 1000) {
        const page = must(
          await db
            .from("gift_memberships")
            .select("id, recipient_member_id, price, tax_amount, paid_at, starts_at, ends_at, stripe_payment_intent_id, stripe_checkout_session_id")
            .eq("status", "paid")
            .gte("paid_at", sinceIso)
            .order("id")
            .range(from, from + 999),
        ) as GiftLike[];
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async insert(rows) {
      let added = 0;
      for (const c of chunks(rows)) added += (must(await table().upsert(c, { onConflict: "source_id", ignoreDuplicates: true }).select("id")) as unknown[]).length;
      return added;
    },
    async update(id, patch) {
      must(await table().update({ ...patch, synced_at: new Date().toISOString() }).eq("id", id).select("id"));
    },
    async removeRefunds(ids) {
      let removed = 0;
      for (const c of chunks(ids)) removed += (must(await table().delete().in("source_id", c).eq("kind", "refund").select("id")) as unknown[]).length;
      return removed;
    },
    async refundsOf(ids) {
      const out: SavedRefund[] = [];
      for (const c of chunks(ids)) out.push(...(must(await table().select("refund_of, source_id, amount_cents, tax_cents").in("refund_of", c)) as SavedRefund[]));
      return out;
    },
    async saveEnds(rows) {
      let saved = 0;
      for (const c of chunks(rows)) saved += (must(await db.from("member_subscription_ends").upsert(c.map((r) => ({ ...r, synced_at: new Date().toISOString() })), { onConflict: "stripe_subscription_id" }).select("id")) as unknown[]).length;
      return saved;
    },
  };
}

// ---------- a dry run: what would be saved, saving nothing ----------
// Works before the database update is applied: nothing is read from
// member_payments, so every payment counts as new. `gifts` come from Stripe
// (giftsFromStripe) instead of the database.

export function dryRunStore(gifts: GiftLike[] = []): PaymentStore & { rows: PaymentRow[]; ends: EndRow[] } {
  const rows: PaymentRow[] = [];
  const ends: EndRow[] = [];
  return {
    rows,
    ends,
    existing: async () => [],
    byPaymentIntent: async () => [],
    hasEarlierPlus: async () => false,
    members: async () => [],
    paidGifts: async (sinceIso) => gifts.filter((g) => g.paid_at >= sinceIso),
    insert: async (r) => {
      rows.push(...r);
      return r.length;
    },
    update: async () => undefined,
    removeRefunds: async () => 0,
    refundsOf: async () => [],
    saveEnds: async (r) => {
      ends.push(...r);
      return r.length;
    },
  };
}

// Paid gift memberships as Stripe has them (for a dry run). When it was
// paid is taken as when the payment page was opened: close enough to find
// the day.
export async function giftsFromStripe(stripe: Stripe, fromIso: string): Promise<GiftLike[]> {
  const out: GiftLike[] = [];
  for await (const s of stripe.checkout.sessions.list({ created: { gte: unixOf(fromIso) }, status: "complete", limit: 100 })) {
    const id = s.metadata?.gift_membership_id;
    if (s.mode !== "payment" || !id || s.payment_status !== "paid") continue;
    out.push({
      id,
      recipient_member_id: null,
      price: (s.amount_subtotal ?? 0) / 100,
      tax_amount: (s.total_details?.amount_tax ?? 0) / 100,
      paid_at: isoOf(s.created),
      starts_at: null,
      ends_at: null,
      stripe_payment_intent_id: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
      stripe_checkout_session_id: s.id,
    });
  }
  return out;
}
