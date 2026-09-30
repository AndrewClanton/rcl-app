import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LAUNCH,
  endRow,
  giftRow,
  paymentStatus,
  plusKind,
  priceInfo,
  readPlusInvoice,
  refundPaymentIntent,
  refundRow,
  refundTaxCents,
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
  refundsOf(paymentIds: string[]): Promise<{ refund_of: string; amount_cents: number }[]>;
  saveEnds(rows: EndRow[]): Promise<number>;
}

export interface Engine {
  stripe: Stripe;
  store: PaymentStore;
  ctx: PlusContext;
  // Keep test-mode payments too (normally only live ones are saved).
  allowTest: boolean;
}

export interface SyncCounts {
  invoices: number; // paid invoices looked at
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
  return { invoices: 0, plus: { added: 0, updated: 0 }, gifts: { added: 0, updated: 0 }, refunds: { added: 0, updated: 0, removed: 0 }, ends: 0, skipped: { nothingCharged: 0, testMode: 0 }, warnings: [] };
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
  return { productId, prices };
}

// ---------- one run ----------

// Everything from `fromIso` on: paid Insiders+ invoices, paid gifts,
// refunds of either, and subscriptions that ended.
export async function runPaymentSync(e: Engine, fromIso: string): Promise<SyncCounts> {
  const counts = emptyCounts();
  const from = unixOf(fromIso < LAUNCH ? LAUNCH : fromIso);

  // Everything is read at once (a Reports page waits on this), then saved in order.
  const [invoices, refunds, ended, gifts] = await Promise.all([
    listAll(e.stripe.invoices.list({ status: "paid", created: { gte: from }, limit: 100, expand: ["data.payments"] })),
    // Every refund on the account (tickets and the register too); only the
    // ones on a membership payment are kept.
    listAll(e.stripe.refunds.list({ created: { gte: from }, limit: 100 })),
    // Stripe keeps events for 30 days; the daily run reads every day. Best
    // effort: the payments stand without it.
    listAll(e.stripe.events.list({ type: "customer.subscription.deleted", created: { gte: from }, limit: 100 })).catch((err: unknown) => {
      counts.warnings.push(`ended subscriptions not read: ${err instanceof Error ? err.message : String(err)}`);
      return [] as Stripe.Event[];
    }),
    e.store.paidGifts(isoOf(from)),
  ]);

  // 1. Insiders+ charges.
  counts.invoices = invoices.length;
  const plusRows = await saveInvoices(e, invoices as unknown as InvoiceLike[], counts);

  // 2. Gift memberships (the database already has them).
  const giftRows: PaymentRow[] = [];
  for (const g of gifts) {
    const row = giftRow(g);
    if (!row.livemode && !e.allowTest) counts.skipped.testMode++;
    else giftRows.push(row);
  }
  await saveRows(e, giftRows, counts.gifts);

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

async function listAll<T>(list: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of list) out.push(x);
  return out;
}

// Paid invoices -> saved Insiders+ rows (the ones that are Insiders+ and
// charged something). Returns the rows, new and already saved.
export async function saveInvoices(e: Engine, invoices: InvoiceLike[], counts: SyncCounts): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
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

// New or a renewal: was there a charge on the same subscription before
// this one? This run's own rows first, then the saved ones, then Stripe.
async function classify(e: Engine, row: PaymentRow, all: PaymentRow[]) {
  if (row.product !== "plus" || row.billing_reason === "subscription_create") return;
  const sub = row.stripe_subscription_id;
  let earlier = !!sub && all.some((o) => o !== row && o.product === "plus" && o.stripe_subscription_id === sub && o.paid_at < row.paid_at);
  if (!earlier && sub) earlier = await e.store.hasEarlierPlus(sub, row.paid_at);
  if (!earlier && sub) {
    const before = unixOf(row.paid_at);
    for await (const inv of e.stripe.invoices.list({ subscription: sub, status: "paid", limit: 100 })) {
      const paidAt = inv.status_transitions?.paid_at ?? inv.created;
      if (inv.id !== row.stripe_invoice_id && inv.amount_paid > 0 && paidAt < before) {
        earlier = true;
        break;
      }
    }
  }
  row.kind = plusKind(row.billing_reason, earlier);
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

  const rows: PaymentRow[] = [];
  const gone: string[] = [];
  const touched = new Map<string, PaymentRow & { id?: string }>();
  for (const re of refunds) {
    const pi = refundPaymentIntent(re);
    const payment = pi ? payments.get(pi) : undefined;
    if (!payment) continue;
    if (payment.id) touched.set(payment.id, payment);
    if (re.status === "failed" || re.status === "canceled") {
      gone.push(re.id);
      continue;
    }
    if (re.status !== "succeeded") continue; // pending: counted once it goes through
    const note = payment.stripe_invoice_id ? await creditNoteTax(e.stripe, payment.stripe_invoice_id, re) : null;
    rows.push(refundRow(re, payment, note?.tax ?? refundTaxCents(re.amount, payment), note?.id ?? null));
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
// minutes of the last read.

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
const QUICK_OVERLAP_DAYS = 3; // quick: from this long before the last read
const DAILY_DAYS = 45; // daily: a renewal that failed and was paid weeks later is still caught
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

// One run: claim it, read Stripe, save, and mark when. Never throws: a
// failure is recorded (so the next try waits the usual 10 minutes, not
// forever) and returned. `force`: read even if the last read was just now
// (still not while another run is going; the daily one waits its turn).
export async function lockedSync(db: SupabaseClient, getEngine: () => Promise<Engine>, opts: { mode: SyncMode; since?: string; force?: boolean }): Promise<SyncResult> {
  const t0 = Date.now();
  const done = (r: Omit<SyncResult, "mode" | "ms">): SyncResult => ({ mode: opts.mode, ms: Date.now() - t0, ...r });
  let claimed = false;
  try {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await db.rpc("claim_member_payment_sync", { p_fresh_seconds: opts.force ? 0 : FRESH_SECONDS, p_lock_seconds: LOCK_SECONDS });
      if (error) return done({ ok: false, skipped: "not set up (is migration 20261001110000_member_payments.sql applied?)", error: error.message });
      if (data === true) break;
      // Only the daily run waits (up to ~36 s) behind a run already going,
      // then counts on it if it finished meanwhile.
      if (opts.mode !== "daily" || attempt >= 12) return done({ ok: true, skipped: "read recently, or a read is already going" });
      await sleep(3000);
      const { data: s } = await db.from("member_payment_sync").select("started_at, finished_at").maybeSingle();
      if (s && msOf(s.finished_at) >= t0 && !syncRunning(s)) return done({ ok: true, skipped: "another read just finished" });
    }
    claimed = true;

    const { data: state, error: stateErr } = await db.from("member_payment_sync").select("invoices_through").maybeSingle();
    if (stateErr) throw stateErr;
    const through = (state?.invoices_through as string | null | undefined) ?? null;
    const from = syncFrom(opts.mode, through, t0, opts.since);

    const counts = await runPaymentSync(await getEngine(), from);
    const now = new Date().toISOString();
    // Reads overlap; the mark never moves back.
    const mark = new Date(Math.max(t0, msOf(through))).toISOString();
    const { error: saveErr } = await db
      .from("member_payment_sync")
      .update({ finished_at: now, succeeded_at: now, invoices_through: mark, refunds_through: mark, last_error: null, last_result: { mode: opts.mode, from, ms: Date.now() - t0, ...counts } })
      .eq("id", true);
    if (saveErr) console.warn("member payments: read saved, but not when:", saveErr.message);
    return done({ ok: true, from, counts });
  } catch (e) {
    const error = errorMessage(e);
    console.error(`member payments: ${opts.mode} read from Stripe failed:`, error);
    if (claimed) {
      await db
        .from("member_payment_sync")
        .update({ finished_at: new Date().toISOString(), started_at: null, last_error: error.slice(0, 500) })
        .eq("id", true)
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
      const out: { refund_of: string; amount_cents: number }[] = [];
      for (const c of chunks(ids)) out.push(...must(await table().select("refund_of, amount_cents").in("refund_of", c)) as { refund_of: string; amount_cents: number }[]);
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
