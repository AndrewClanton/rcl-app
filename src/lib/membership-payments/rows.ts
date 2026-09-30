// Insiders+ and gift membership payments as Reports count them: the rows of
// member_payments (supabase/migrations/20261001110000_member_payments.sql)
// and the rules for making them from what Stripe says. No imports and no
// database or Stripe calls, so the sync (./engine.ts), Reports, the browser
// and scripts/check-member-payments.mjs all use the same rules.
//
// One row per card charge Stripe made for Insiders+ (a paid invoice), per
// paid gift membership, and per refund of either. Money is in cents. A
// refund is its own row with negative amounts, counted on the day of the
// payment it gives back (like a register partial refund), so adding up
// every row in a stretch of days gives what that stretch really brought in.

export type PaymentKind = "plus_new" | "plus_renewal" | "plus_switch" | "gift" | "refund";
export type PaymentProduct = "plus" | "gift";
export type Tier = "adult" | "senior" | "student";
export type Interval = "month" | "year";
export type PaymentStatus = "paid" | "partly_refunded" | "refunded" | "succeeded";

export const TIERS: Tier[] = ["adult", "senior", "student"];
const TIER_LABEL: Record<Tier, string> = { adult: "Adult", senior: "Senior", student: "Student" };

// When Insiders+ went on sale on this site (9/14, midnight Central). Nothing
// earlier is read from Stripe.
export const LAUNCH = "2026-09-14T05:00:00.000Z";

export interface PaymentRow {
  source_id: string;
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
  billing_reason: string | null;
  period_start: string | null;
  period_end: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  stripe_credit_note_id: string | null;
  gift_membership_id: string | null;
  refund_of: string | null;
  livemode: boolean;
}

export interface StoredPayment extends PaymentRow {
  id: string;
}

// ---------- the business day ----------
// 4 a.m. to 4 a.m. Central, by the wall clock (so the nights the clocks
// change roll over at 4 a.m. too), the same day Reports and the register use.

const TZ = "America/Chicago";
const DAY_STARTS_AT_HOUR = 4;
let wallClock: Intl.DateTimeFormat | null = null;

export function businessDateOf(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (!wallClock) wallClock = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const x of wallClock.formatToParts(d)) p[x.type] = x.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) >= DAY_STARTS_AT_HOUR) return date;
  const before = new Date(`${date}T12:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return before.toISOString().slice(0, 10);
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
const idOf = (x: string | { id: string } | null | undefined): string | null => (typeof x === "string" ? x : (x?.id ?? null));

// ---------- which Stripe prices are Insiders+ ----------

export interface PriceInfo {
  tier: Tier | null;
  interval: Interval | null;
}

export interface PlusContext {
  productId: string | null; // the "Royale Insiders+" product
  prices: Map<string, PriceInfo>; // every price on it, old ones too
}

// What a price is: yearly ones by their lookup key (insiders_plus_adult_yearly),
// monthly ones by the price ids the site is set up with, and failing both by
// the amount ($15/$12/$10 a month, $153/$122.40/$102 a year).
export function priceInfo(
  price: { id: string; lookup_key?: string | null; unit_amount?: number | null; recurring?: { interval?: string | null } | null },
  monthlyIds: Partial<Record<Tier, string>>,
): PriceInfo {
  const raw = price.recurring?.interval;
  const interval: Interval | null = raw === "year" ? "year" : raw === "month" ? "month" : null;
  const byKey = /^insiders_plus_(adult|senior|student)_yearly$/.exec(price.lookup_key ?? "");
  if (byKey) return { tier: byKey[1] as Tier, interval: interval ?? "year" };
  const byId = TIERS.find((t) => monthlyIds[t] === price.id);
  if (byId) return { tier: byId, interval: interval ?? "month" };
  const amounts: Record<Interval, Record<number, Tier>> = {
    month: { 1500: "adult", 1200: "senior", 1000: "student" },
    year: { 15300: "adult", 12240: "senior", 10200: "student" },
  };
  return { tier: interval && price.unit_amount != null ? (amounts[interval][price.unit_amount] ?? null) : null, interval };
}

// ---------- an Insiders+ invoice ----------
// Only the fields read here, so a Stripe invoice fits, and so does a plain
// object in the checks. (Stripe API 2026-08-26.dahlia: the subscription is
// under parent.subscription_details, the payment under payments.)

export interface InvoiceLineLike {
  amount: number;
  period?: { start: number; end: number } | null;
  pricing?: { price_details?: { price?: string | { id: string } | null; product?: string | null } | null } | null;
  parent?: { subscription_item_details?: { proration?: boolean | null } | null } | null;
}

export interface InvoiceLike {
  id?: string | null;
  customer?: string | { id: string } | null;
  livemode: boolean;
  status?: string | null;
  billing_reason?: string | null;
  amount_paid: number;
  total: number;
  total_excluding_tax?: number | null;
  total_taxes?: { amount: number }[] | null;
  created: number;
  status_transitions?: { paid_at?: number | null } | null;
  parent?: { type?: string | null; subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  lines?: { data: InvoiceLineLike[] } | null;
  payments?: { data: { status?: string | null; payment?: { payment_intent?: string | { id: string } | null } | null }[] } | null;
}

export type InvoiceSkip = "not_plus" | "unpaid" | "nothing_charged";

const linePrice = (l: InvoiceLineLike) => idOf(l.pricing?.price_details?.price ?? null);

export function isPlusInvoice(inv: InvoiceLike, ctx: PlusContext): boolean {
  if (inv.parent?.type !== "subscription_details") return false;
  return (inv.lines?.data ?? []).some((l) => {
    const product = l.pricing?.price_details?.product;
    const price = linePrice(l);
    return (!!ctx.productId && product === ctx.productId) || (!!price && ctx.prices.has(price));
  });
}

// A paid Insiders+ invoice as a row, or why it isn't one. Its kind here is
// provisional (see plusKind): a charge that isn't the subscription's first
// is only known to be a renewal once the ones before it are looked up.
// Skipped: an invoice for nothing (the $0 one a card saved for a later first
// charge makes, a 100%-off one, a change that nets to zero).
export function readPlusInvoice(inv: InvoiceLike, ctx: PlusContext): { row: PaymentRow } | { skip: InvoiceSkip } {
  if (!isPlusInvoice(inv, ctx)) return { skip: "not_plus" };
  if (inv.status !== "paid") return { skip: "unpaid" };
  const tax = (inv.total_taxes ?? []).reduce((s, t) => s + t.amount, 0);
  if (inv.amount_paid === 0 && tax === 0) return { skip: "nothing_charged" };

  const lines = inv.lines?.data ?? [];
  // The plan it's for: the first charge that isn't a proration (a switch to
  // yearly has a credit for the unused month, then the year).
  const plan =
    lines.find((l) => l.amount > 0 && !l.parent?.subscription_item_details?.proration) ?? lines.find((l) => l.amount > 0) ?? lines[0] ?? null;
  const price = plan ? linePrice(plan) : null;
  const info = (price && ctx.prices.get(price)) || { tier: null, interval: null };
  const paidAt = iso(inv.status_transitions?.paid_at ?? inv.created);
  const payment = (inv.payments?.data ?? []).find((p) => p.status === "paid") ?? inv.payments?.data?.[0];

  return {
    row: {
      source_id: inv.id ?? "",
      kind: plusKind(inv.billing_reason ?? null, true),
      product: "plus",
      member_id: null,
      tier: info.tier,
      billing_interval: info.interval,
      amount_cents: inv.amount_paid,
      sales_cents: inv.total_excluding_tax ?? inv.total - tax,
      tax_cents: tax,
      paid_at: paidAt,
      counted_at: paidAt,
      business_date: businessDateOf(paidAt),
      status: "paid",
      billing_reason: inv.billing_reason ?? null,
      period_start: plan?.period ? iso(plan.period.start) : null,
      period_end: plan?.period ? iso(plan.period.end) : null,
      stripe_invoice_id: inv.id ?? null,
      stripe_subscription_id: idOf(inv.parent?.subscription_details?.subscription ?? null),
      stripe_customer_id: idOf(inv.customer ?? null),
      stripe_payment_intent_id: idOf(payment?.payment?.payment_intent ?? null),
      stripe_refund_id: null,
      stripe_credit_note_id: null,
      gift_membership_id: null,
      refund_of: null,
      livemode: inv.livemode,
    },
  };
}

// New, a renewal, or a switch. The subscription's first charge is new: at
// sign-up (subscription_create), or later when a card was saved for a
// later first charge or a gift ran first (then Stripe calls it a cycle).
// `earlierPaid`: the subscription had a charge before this one.
export function plusKind(billingReason: string | null, earlierPaid: boolean): PaymentKind {
  if (billingReason === "subscription_create" || !earlierPaid) return "plus_new";
  return billingReason === "subscription_update" ? "plus_switch" : "plus_renewal";
}

// ---------- a gift membership ----------

export interface GiftLike {
  id: string;
  recipient_member_id: string | null;
  price: number | string;
  tax_amount: number | string;
  paid_at: string;
  starts_at: string | null;
  ends_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
}

const cents = (dollars: number | string) => Math.round(Number(dollars) * 100);

export function giftRow(g: GiftLike): PaymentRow {
  const sales = cents(g.price);
  const tax = cents(g.tax_amount);
  const paidAt = new Date(g.paid_at).toISOString();
  return {
    source_id: `gift:${g.id}`,
    kind: "gift",
    product: "gift",
    member_id: g.recipient_member_id,
    // Gifts are a year at the adult price (lib/gift-membership.ts).
    tier: "adult",
    billing_interval: "year",
    amount_cents: sales + tax,
    sales_cents: sales,
    tax_cents: tax,
    paid_at: paidAt,
    counted_at: paidAt,
    business_date: businessDateOf(paidAt),
    status: "paid",
    billing_reason: null,
    period_start: g.starts_at,
    period_end: g.ends_at,
    stripe_invoice_id: null,
    stripe_subscription_id: null,
    stripe_customer_id: null,
    stripe_payment_intent_id: g.stripe_payment_intent_id,
    stripe_refund_id: null,
    stripe_credit_note_id: null,
    gift_membership_id: g.id,
    refund_of: null,
    // Gifts are paid on a Stripe payment page; its id says live or test.
    // (Without one, it's taken as live: the id is saved as the page opens,
    // before anyone can pay.)
    livemode: g.stripe_checkout_session_id ? g.stripe_checkout_session_id.startsWith("cs_live_") : true,
  };
}

// ---------- a refund ----------

export interface RefundLike {
  id: string;
  amount: number;
  created: number;
  status?: string | null;
  payment_intent?: string | { id: string } | null;
}

export function refundPaymentIntent(re: RefundLike): string | null {
  return idOf(re.payment_intent ?? null);
}

// The tax in a refund, when no credit note says: the payment's share.
export function refundTaxCents(refundCents: number, payment: Pick<PaymentRow, "amount_cents" | "tax_cents">): number {
  if (payment.amount_cents <= 0) return 0;
  return Math.round((refundCents * payment.tax_cents) / payment.amount_cents);
}

// A refund as its own row: negative, and counted on its payment's day, so
// it comes off the day of the sale. `taxCents` is the tax in it (a credit
// note's, or refundTaxCents).
export function refundRow(re: RefundLike, payment: PaymentRow & { id?: string }, taxCents: number, creditNoteId: string | null = null): PaymentRow {
  return {
    source_id: re.id,
    kind: "refund",
    product: payment.product,
    member_id: payment.member_id,
    tier: payment.tier,
    billing_interval: payment.billing_interval,
    amount_cents: -re.amount,
    sales_cents: -(re.amount - taxCents),
    tax_cents: -taxCents,
    paid_at: iso(re.created),
    counted_at: payment.counted_at,
    business_date: payment.business_date,
    status: "succeeded",
    billing_reason: null,
    period_start: null,
    period_end: null,
    stripe_invoice_id: payment.stripe_invoice_id,
    stripe_subscription_id: payment.stripe_subscription_id,
    stripe_customer_id: payment.stripe_customer_id,
    stripe_payment_intent_id: refundPaymentIntent(re),
    stripe_refund_id: re.id,
    stripe_credit_note_id: creditNoteId,
    gift_membership_id: payment.gift_membership_id,
    refund_of: payment.id ?? null,
    livemode: payment.livemode,
  };
}

// A payment's status once its refunds are known (refundedCents: what they
// gave back, as a positive number).
export function paymentStatus(paymentCents: number, refundedCents: number): "paid" | "partly_refunded" | "refunded" {
  if (refundedCents <= 0) return "paid";
  return refundedCents >= paymentCents ? "refunded" : "partly_refunded";
}

// ---------- an Insiders+ subscription that ended ----------

export interface EndRow {
  stripe_subscription_id: string;
  stripe_customer_id: string | null;
  member_id: string | null;
  tier: Tier | null;
  billing_interval: Interval | null;
  ended_at: string;
  business_date: string;
  reason: string | null;
  livemode: boolean;
}

export interface SubscriptionLike {
  id: string;
  customer?: string | { id: string } | null;
  livemode: boolean;
  status?: string | null;
  ended_at?: number | null;
  canceled_at?: number | null;
  cancellation_details?: { reason?: string | null } | null;
  items?: { data: { price?: { id: string; product?: string | { id: string } | null } | null }[] } | null;
}

export function endRow(sub: SubscriptionLike, ctx: PlusContext): EndRow | null {
  const price = sub.items?.data?.[0]?.price ?? null;
  const product = idOf(price?.product ?? null);
  if (!price || !(ctx.prices.has(price.id) || (!!ctx.productId && product === ctx.productId))) return null;
  const at = sub.ended_at ?? sub.canceled_at;
  if (!at) return null;
  const info = ctx.prices.get(price.id) ?? { tier: null, interval: null };
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: idOf(sub.customer ?? null),
    member_id: null,
    tier: info.tier,
    billing_interval: info.interval,
    ended_at: iso(at),
    business_date: businessDateOf(iso(at)),
    reason: sub.cancellation_details?.reason ?? null,
    livemode: sub.livemode,
  };
}

// ---------- adding them up ----------

export type SummaryRow = Pick<PaymentRow, "kind" | "billing_interval" | "amount_cents" | "sales_cents" | "tax_cents">;

export type MembershipLineKey = "new_month" | "new_year" | "renewal" | "switch" | "gift" | "refund";

export interface MembershipLine {
  key: MembershipLineKey;
  label: string;
  count: number;
  collected: number; // dollars, tax included
  sales: number; // dollars, before tax
  tax: number;
}

export interface MembershipTotals {
  // False until the member payments database update is applied (nothing is
  // counted then, and the screens say so).
  tracked: boolean;
  collected: number; // money in, dollars, tax included, refunds taken off
  sales: number; // before tax, refunds taken off
  tax: number; // refunds' tax taken off
  refunded: number; // given back (a positive number), already taken off the three above
  payments: number; // charges and gifts (refunds not counted)
  newMonthly: number;
  newYearly: number;
  renewals: number;
  switches: number;
  gifts: number;
  refunds: number;
  lines: MembershipLine[]; // the kinds there were, in LINE_ORDER
}

const LINE_LABEL: Record<MembershipLineKey, string> = {
  new_month: "New monthly",
  new_year: "New yearly",
  renewal: "Renewals",
  switch: "Switched to yearly",
  gift: "Gift memberships",
  refund: "Refunds",
};
const LINE_ORDER: MembershipLineKey[] = ["new_month", "new_year", "renewal", "switch", "gift", "refund"];

export function lineKey(r: Pick<PaymentRow, "kind" | "billing_interval">): MembershipLineKey {
  if (r.kind === "plus_new") return r.billing_interval === "year" ? "new_year" : "new_month";
  if (r.kind === "plus_renewal") return "renewal";
  if (r.kind === "plus_switch") return "switch";
  return r.kind;
}

export function summarizeMemberships(rows: SummaryRow[], tracked = true): MembershipTotals {
  const by = new Map<MembershipLineKey, { count: number; amount: number; sales: number; tax: number }>();
  let amount = 0,
    sales = 0,
    tax = 0,
    refunded = 0;
  for (const r of rows) {
    const k = lineKey(r);
    const l = by.get(k) ?? { count: 0, amount: 0, sales: 0, tax: 0 };
    l.count++;
    l.amount += r.amount_cents;
    l.sales += r.sales_cents;
    l.tax += r.tax_cents;
    by.set(k, l);
    amount += r.amount_cents;
    sales += r.sales_cents;
    tax += r.tax_cents;
    if (r.kind === "refund") refunded -= r.amount_cents;
  }
  const count = (k: MembershipLineKey) => by.get(k)?.count ?? 0;
  return {
    tracked,
    collected: amount / 100,
    sales: sales / 100,
    tax: tax / 100,
    refunded: refunded / 100,
    payments: rows.length - count("refund"),
    newMonthly: count("new_month"),
    newYearly: count("new_year"),
    renewals: count("renewal"),
    switches: count("switch"),
    gifts: count("gift"),
    refunds: count("refund"),
    lines: LINE_ORDER.filter((k) => by.has(k)).map((k) => {
      const l = by.get(k)!;
      return { key: k, label: LINE_LABEL[k], count: l.count, collected: l.amount / 100, sales: l.sales / 100, tax: l.tax / 100 };
    }),
  };
}

export function emptyMemberships(tracked = true): MembershipTotals {
  return summarizeMemberships([], tracked);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "1 new yearly · 2 renewals · 1 gift" (empty when there's nothing).
export function membershipsDetail(t: MembershipTotals): string {
  return [
    t.newMonthly ? `${t.newMonthly} new monthly` : "",
    t.newYearly ? `${t.newYearly} new yearly` : "",
    t.renewals ? plural(t.renewals, "renewal", "renewals") : "",
    t.switches ? plural(t.switches, "switch to yearly", "switches to yearly") : "",
    t.gifts ? plural(t.gifts, "gift", "gifts") : "",
    t.refunds ? plural(t.refunds, "refund", "refunds") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// "Adult yearly", "Senior monthly" (or just the tier or the plan when one isn't known).
export function planLabel(tier: Tier | null, interval: Interval | null): string {
  const t = tier ? TIER_LABEL[tier] : "";
  const i = interval === "year" ? "yearly" : interval === "month" ? "monthly" : "";
  return [t, i].filter(Boolean).join(" ") || "Insiders+";
}

// One payment in a list: "New · Adult yearly", "Renewal · Senior monthly",
// "Gift · a year", "Refund · Adult monthly".
export function paymentLabel(r: Pick<PaymentRow, "kind" | "tier" | "billing_interval" | "product">): string {
  switch (r.kind) {
    case "plus_new":
      return `New · ${planLabel(r.tier, r.billing_interval)}`;
    case "plus_renewal":
      return `Renewal · ${planLabel(r.tier, r.billing_interval)}`;
    case "plus_switch":
      return `Switched to yearly · ${planLabel(r.tier, null)}`;
    case "gift":
      return "Gift · a year of Insiders+";
    default:
      return `Refund · ${r.product === "gift" ? "gift membership" : planLabel(r.tier, r.billing_interval)}`;
  }
}
