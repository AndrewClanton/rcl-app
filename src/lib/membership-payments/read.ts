import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "@/lib/ops/time";
import { subscriptionLive } from "@/lib/plus-status";
import { countedModes, paymentsSyncAllowed, stripeKeyMode } from "./mode";
import {
  TIERS,
  giftRow,
  paymentLabel,
  planLabel,
  summarizeMemberships,
  type GiftLike,
  type Interval,
  type MembershipTotals,
  type PaymentKind,
  type PaymentProduct,
  type PaymentStatus,
  type Tier,
} from "./rows";

// Member payments as Reports read them (member_payments, filled from Stripe
// by ./sync.ts). Every reader copes with the table not being there yet:
// nothing is counted, and `tracked: false` lets the screens say why.

// One row, as Reports use it.
export interface MemberPaymentRecord {
  id: string;
  kind: PaymentKind;
  product: PaymentProduct;
  member_id: string | null;
  tier: Tier | null;
  billing_interval: Interval | null;
  amount_cents: number;
  sales_cents: number;
  tax_cents: number;
  paid_at: string;
  counted_at: string;
  business_date: string;
  status: PaymentStatus;
  period_end: string | null;
  refund_of: string | null;
  member: { name: string } | null;
}

// One payment in a list (the Day drill-down, the Members tab), in dollars.
export interface MemberPaymentLine {
  id: string;
  kind: PaymentKind;
  label: string; // "New · Adult yearly"
  memberId: string | null;
  memberName: string | null;
  amount: number; // with tax; negative for a refund
  sales: number;
  tax: number;
  paidAt: string; // a refund: when it was refunded
  countedAt: string; // a refund: its payment's
  periodEnd: string | null; // an Insiders+ charge: the next bill
  status: PaymentStatus;
}

const COLUMNS = "id, kind, product, member_id, tier, billing_interval, amount_cents, sales_cents, tax_cents, paid_at, counted_at, business_date, status, period_end, refund_of, member:members(name)";

export function paymentLine(r: MemberPaymentRecord): MemberPaymentLine {
  return {
    id: r.id,
    kind: r.kind,
    label: paymentLabel(r),
    memberId: r.member_id,
    memberName: r.member?.name ?? null,
    amount: r.amount_cents / 100,
    sales: r.sales_cents / 100,
    tax: r.tax_cents / 100,
    paidAt: r.paid_at,
    countedAt: r.counted_at,
    periodEnd: r.period_end,
    status: r.status,
  };
}

function quiet(what: string, e: unknown) {
  console.warn(`member payments: ${what} not read (migration 20261001110000_member_payments.sql applied?):`, (e as PostgrestError)?.message ?? e);
}

// Live payments only, unless test ones are allowed (a test database).
const modes = countedModes;

// Payments counted between two instants (business-day edges; end null: up
// to now), by id. Refunds are counted with their payment, on its day. Paid
// gift memberships the sync hasn't saved yet are counted too (unsavedGifts).
export async function getMemberPaymentsBetween(start: string, end: string | null): Promise<{ tracked: boolean; rows: MemberPaymentRecord[] }> {
  const supabase = createAdminClient();
  const rows: MemberPaymentRecord[] = [];
  try {
    for (let from = 0; ; from += 1000) {
      let q = supabase.from("member_payments").select(COLUMNS).in("livemode", modes()).gte("counted_at", start);
      if (end) q = q.lt("counted_at", end);
      const { data, error } = await q.order("id").range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []) as unknown as MemberPaymentRecord[]));
      if (!data || data.length < 1000) break;
    }
  } catch (e) {
    quiet("payments", e);
    return { tracked: false, rows: [] };
  }
  try {
    rows.push(...(await unsavedGifts(start, end)));
  } catch (e) {
    console.warn("member payments: gifts not yet read from Stripe weren't looked for:", (e as PostgrestError)?.message ?? e);
  }
  return { tracked: true, rows };
}

const GIFT_COLUMNS = "id, recipient_member_id, price, tax_amount, paid_at, starts_at, ends_at, stripe_payment_intent_id, stripe_checkout_session_id, member:members(name)";

// Paid gift memberships (by when paid) that have no member_payments row
// yet, as the row the sync will save. A gift is in gift_memberships the
// moment it's paid; the sync copies it over at its next read (or the
// webhook does right away), and it's read along with Stripe, so without
// this a gift would drop out of Reports (the Sales tax tab read gifts
// straight from gift_memberships before) whenever Stripe can't be read.
async function unsavedGifts(start: string, end: string | null): Promise<MemberPaymentRecord[]> {
  const supabase = createAdminClient();
  type Gift = GiftLike & { member: { name: string } | null };
  const gifts: Gift[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("gift_memberships").select(GIFT_COLUMNS).eq("status", "paid").gte("paid_at", start);
    if (end) q = q.lt("paid_at", end);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw error;
    gifts.push(...((data ?? []) as unknown as Gift[]));
    if (!data || data.length < 1000) break;
  }
  if (!gifts.length) return [];

  // Saved already, whatever day it was counted on (never counted twice).
  const saved = new Set<string>();
  const ids = gifts.map((g) => `gift:${g.id}`);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("member_payments").select("source_id").in("source_id", ids.slice(i, i + 100));
    if (error) throw error;
    for (const r of (data ?? []) as { source_id: string }[]) saved.add(r.source_id);
  }

  const counted = modes();
  const out: MemberPaymentRecord[] = [];
  for (const g of gifts) {
    const row = giftRow(g);
    if (saved.has(row.source_id) || !counted.includes(row.livemode)) continue;
    out.push({
      id: row.source_id,
      kind: row.kind,
      product: row.product,
      member_id: row.member_id,
      tier: row.tier,
      billing_interval: row.billing_interval,
      amount_cents: row.amount_cents,
      sales_cents: row.sales_cents,
      tax_cents: row.tax_cents,
      paid_at: row.paid_at,
      counted_at: row.counted_at,
      business_date: row.business_date,
      status: row.status,
      period_end: row.period_end,
      refund_of: null,
      member: g.member,
    });
  }
  return out;
}

// Refunds given back between two instants (by when they were made, not the
// day they're counted on), for the daily email. Empty when the table can't
// be read.
export async function getMembershipRefundsMade(start: string, end: string): Promise<MemberPaymentRecord[]> {
  const { data, error } = await createAdminClient().from("member_payments").select(COLUMNS).eq("kind", "refund").in("livemode", modes()).gte("paid_at", start).lt("paid_at", end).order("paid_at").limit(1000);
  if (error) {
    quiet("refunds", error);
    return [];
  }
  return (data ?? []) as unknown as MemberPaymentRecord[];
}

// Insiders+ subscriptions that ended between two instants. Null when the
// table can't be read.
export async function countSubscriptionEnds(start: string, end: string): Promise<number | null> {
  const { count, error } = await createAdminClient().from("member_subscription_ends").select("id", { count: "exact", head: true }).in("livemode", modes()).gte("ended_at", start).lt("ended_at", end);
  if (error) {
    quiet("ended subscriptions", error);
    return null;
  }
  return count ?? 0;
}

// ---------- when Stripe was last read ----------

export interface PaymentSyncStatus {
  ready: boolean; // the database update is applied
  allowed: boolean; // this server reads Stripe (the live key)
  keyMode: "live" | "test" | "none";
  succeededAt: string | null; // "Last read from Stripe"
  finishedAt: string | null;
  lastError: string | null; // the last read failed with this
}

export async function getPaymentSyncStatus(): Promise<PaymentSyncStatus> {
  const base = { allowed: paymentsSyncAllowed(), keyMode: stripeKeyMode() };
  const { data, error } = await createAdminClient().from("member_payment_sync").select("finished_at, succeeded_at, last_error").maybeSingle();
  if (error || !data) return { ...base, ready: false, succeededAt: null, finishedAt: null, lastError: null };
  // An error only matters if no read has worked since.
  const failedLast = !!data.last_error && (!data.succeeded_at || new Date(data.finished_at ?? 0).getTime() > new Date(data.succeeded_at).getTime());
  return { ...base, ready: true, succeededAt: data.succeeded_at, finishedAt: data.finished_at, lastError: failedLast ? data.last_error : null };
}

// ---------- Reports -> Members ----------

export interface PlanCounts {
  month: Record<Tier, number>;
  year: Record<Tier, number>;
  unknown: number; // paying, plan not known yet (no payment read)
  trialing: number; // card saved, first charge still to come
  pastDue: number; // a renewal didn't go through; Stripe is retrying
  total: number; // everyone Stripe is billing (the four above)
}

export interface MonthMemberships {
  month: string; // "2026-09"
  label: string; // "September"
  totals: MembershipTotals;
  ended: number | null;
}

export interface Renewal {
  memberId: string | null;
  name: string | null;
  plan: string;
  on: string; // the next bill
  last: number; // what the last charge was, with tax
}

export interface MembersPayments {
  tracked: boolean;
  sync: PaymentSyncStatus;
  plans: PlanCounts;
  months: [MonthMemberships, MonthMemberships]; // this month so far, last month
  renewing: Renewal[]; // in the next 7 days
  recent: MemberPaymentLine[]; // the last 25, newest first
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

type BilledMember = { id: string; name: string; price_tier: Tier | null; billing_interval: Interval | null; stripe_subscription_id: string | null; subscription_status: string | null };

export async function getMembersPayments(now = new Date()): Promise<MembersPayments> {
  const supabase = createAdminClient();
  const thisMonth = businessDay(now).date.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const edge = (month: string) => businessDayWindow(`${month}-01`).start;

  const [sync, billed, last, current, recentRes] = await Promise.all([
    getPaymentSyncStatus(),
    supabase
      .from("members")
      .select("id, name, price_tier, billing_interval, stripe_subscription_id, subscription_status")
      .not("stripe_subscription_id", "is", null)
      .is("erased_at", null)
      .limit(5000),
    getMemberPaymentsBetween(edge(lastMonth), edge(thisMonth)),
    getMemberPaymentsBetween(edge(thisMonth), null),
    supabase.from("member_payments").select(COLUMNS).in("livemode", modes()).order("paid_at", { ascending: false }).limit(25),
  ]);
  const [endedLast, endedThis] = await Promise.all([countSubscriptionEnds(edge(lastMonth), edge(thisMonth)), countSubscriptionEnds(edge(thisMonth), now.toISOString())]);
  const tracked = current.tracked;

  // Everyone Stripe is billing, by plan. The plan is on the member row (set
  // at checkout); older rows without it take it from their last payment.
  const members = ((billed.data ?? []) as BilledMember[]).filter((m) => subscriptionLive(m));
  const latest = new Map<string, MemberPaymentRecord>(); // subscription -> its last Insiders+ charge
  if (tracked && members.length) {
    const subs = members.map((m) => m.stripe_subscription_id as string);
    for (let i = 0; i < subs.length; i += 100) {
      const { data } = await supabase
        .from("member_payments")
        .select(`${COLUMNS}, stripe_subscription_id`)
        .in("livemode", modes())
        .in("stripe_subscription_id", subs.slice(i, i + 100))
        .eq("product", "plus")
        .neq("kind", "refund")
        .order("paid_at", { ascending: false });
      for (const r of (data ?? []) as unknown as (MemberPaymentRecord & { stripe_subscription_id: string })[]) {
        if (!latest.has(r.stripe_subscription_id)) latest.set(r.stripe_subscription_id, r);
      }
    }
  }

  const zero = (): Record<Tier, number> => ({ adult: 0, senior: 0, student: 0 });
  const plans: PlanCounts = { month: zero(), year: zero(), unknown: 0, trialing: 0, pastDue: 0, total: members.length };
  const renewing: Renewal[] = [];
  const soon = now.getTime() + 7 * 86_400_000;
  for (const m of members) {
    const pay = latest.get(m.stripe_subscription_id as string);
    if (m.subscription_status === "trialing") plans.trialing++;
    else if (m.subscription_status === "past_due" || m.subscription_status === "unpaid") plans.pastDue++;
    else {
      const interval = m.billing_interval ?? pay?.billing_interval ?? null;
      const tier = m.price_tier ?? pay?.tier ?? "adult";
      if (interval) plans[interval][TIERS.includes(tier) ? tier : "adult"]++;
      else plans.unknown++;
    }
    const next = pay?.period_end ? new Date(pay.period_end).getTime() : null;
    if (pay && next && next >= now.getTime() && next <= soon && m.subscription_status === "active") {
      renewing.push({ memberId: m.id, name: m.name, plan: planLabel(m.price_tier ?? pay.tier, m.billing_interval ?? pay.billing_interval), on: pay.period_end as string, last: pay.amount_cents / 100 });
    }
  }
  renewing.sort((a, b) => a.on.localeCompare(b.on));

  const month = (m: string, rows: MemberPaymentRecord[], ended: number | null): MonthMemberships => ({
    month: m,
    label: MONTHS[Number(m.slice(5)) - 1],
    totals: summarizeMemberships(rows, tracked),
    ended,
  });

  return {
    tracked,
    sync,
    plans,
    months: [month(thisMonth, current.rows, endedThis), month(lastMonth, last.rows, endedLast)],
    renewing,
    recent: recentRes.error ? [] : ((recentRes.data ?? []) as unknown as MemberPaymentRecord[]).map(paymentLine),
  };
}
