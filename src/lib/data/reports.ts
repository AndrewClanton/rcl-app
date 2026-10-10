import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRecipesByItem } from "./recipes";
import { schemaMissing } from "@/lib/schema-missing";
import { isDouble, pouredLines, serveOf } from "@/lib/bar/double";
import { getBarPrices } from "./barBook";
import { businessDay, businessDayWindow, centralDate, recentBusinessDays } from "@/lib/ops/time";
import { SALES_TAX_PERCENT, SALES_TAX_RATE } from "@/lib/sales-tax";
import { taxFreeOrders, type TaxFreeOrder, type TaxFreeOrderRow } from "@/lib/tax-exempt";
import { isGiftCardLine } from "@/lib/register-totals";
import { attachTaxExemptNames } from "./tax-free-names";
import { mostRefundable } from "./refund-plan";
import { BOOTHS_LABEL, CATEGORY_LABEL, MEMBERSHIPS_LABEL, OWNER_TAB_LABEL, TICKETS_LABEL } from "@/lib/report-categories";
import { subscriptionLive } from "@/lib/plus-status";
import { getMemberPaymentsBetween, paymentLine, type MemberPaymentLine, type MemberPaymentRecord } from "@/lib/membership-payments/read";
import { membershipsDetail, summarizeMemberships, type MembershipTotals } from "@/lib/membership-payments/rows";

// Every report here works in business days: 4 a.m. to 4 a.m. Central, the
// same day the register and shifts use, so a late sale counts tonight.
//
// Money comes from three places, kept apart so nothing is counted twice:
// register and web orders (orders); the website's tickets and booths
// (bookings, booth_reservations); and Insiders+ and gift memberships, which
// Stripe bills itself and never go through the register (member_payments,
// read from Stripe by src/lib/membership-payments/sync.ts).
//
// The owner tab (lib/register-totals.ts): an order put on an owner's
// monthly tab is a sale the day it's rung, at the owner rate, with its own
// line in what sold and its tax in the sales tax, but no money came in, so
// it isn't in Collected. A payment against an owner's statement
// (owner_tab_payments) is money in on the day it's recorded.

// ---------- reading more than 1,000 rows ----------
// The database hands back at most 1,000 rows per request and says nothing
// about the rest, so a 90-day report used to quietly stop at the 1,000th
// order. Every range query here goes through fetchAll, which asks page by
// page until a short page. The query must have a stable order (by id) so
// pages don't overlap or skip.

const PAGE = 1000;

// The rows come back untyped (the client has no generated schema, and it
// guesses a joined row is a list); T says what they really are.
type Page = PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>;

export async function fetchAll<T>(page: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- partial refunds ----------
// Part of an order given back (Reports, "Refund part"), one row each in
// order_partial_refunds (migration 20260929213100_order_partial_refunds.sql).
// A full refund doesn't add a row: it flips the order to 'refunded', which
// every report already leaves out. Partial refunds are taken off the day
// the order was sold, the same as a full refund is.

export interface PartialRefundRow {
  order_id: string;
  amount: number;
  tax_amount: number;
  card_amount: number;
  cash_amount: number;
  created_at: string;
  orders: { completed_at: string; source: string; status: string };
}

// Partial refunds on completed orders sold between start and end. Empty
// (not an error) until the migration is applied.
export async function getPartialRefunds(start: string, end: string | null): Promise<PartialRefundRow[]> {
  const supabase = createAdminClient();
  try {
    return await fetchAll<PartialRefundRow>((from, to) => {
      let q = supabase
        .from("order_partial_refunds")
        .select("order_id, amount, tax_amount, card_amount, cash_amount, created_at, orders!inner(completed_at, source, status)")
        .eq("orders.status", "completed")
        .gte("orders.completed_at", start);
      if (end) q = q.lt("orders.completed_at", end);
      return q.order("id").range(from, to);
    });
  } catch (e) {
    console.warn("order_partial_refunds not read (migration 20260929213100_order_partial_refunds.sql applied?):", (e as PostgrestError).message);
    return [];
  }
}

// ---------- online tickets: paid seats and free seats ----------
// An Insiders+ member's free seat rides on the same online booking as the
// seats they pay for: quantity counts both, unit_price is the paid price
// (src/app/(site)/showtimes/[id]/actions.ts), and Stripe charged, and taxed,
// only the paid ones. So quantity x unit_price overstates such a booking by
// one ticket. The sales tax Stripe recorded says how many were paid (it is
// the price x paid seats x the rate, to the cent). Bookings without tax
// recorded (before 9/28) and register tickets are taken as they are.
export function bookingSeats(b: { quantity: number; unit_price: number; tax_amount: number | null; order_id?: string | null }): { paid: number; free: number } {
  const price = Number(b.unit_price);
  const tax = Number(b.tax_amount ?? 0);
  if (!(price > 0)) return { paid: 0, free: b.quantity };
  if (b.order_id || !(tax > 0)) return { paid: b.quantity, free: 0 };
  const paid = Math.min(b.quantity, Math.max(1, Math.round(tax / (price * SALES_TAX_RATE))));
  return { paid, free: b.quantity - paid };
}

// ---------- one business day ----------

export interface DayOrder {
  id: string;
  orderNumber: number;
  status: string; // completed | refunded | voided
  at: string;
  cashier: string | null;
  name: string | null;
  items: string;
  method: string | null;
  tip: number;
  total: number;
  // Partial refunds so far (the full amount when status is 'refunded' isn't counted here).
  refunded: number;
  // What a partial refund can still give back: what was paid in cash or on a
  // card for the goods (tips and vouchers aren't refunded in part), less
  // earlier partial refunds.
  refundable: number;
  paidByCard: boolean; // card money goes back through Stripe
  businessDate: string;
  // The rest is for the Day report's drill-downs (./DayDrill.tsx), so each
  // figure can list the orders behind it with the same arithmetic.
  source: string; // pos | web
  cashierId: string | null; // the cashier picked on the register
  tax: number;
  taxFree: boolean;
  // How it was paid, as recorded (register orders), before partial refunds.
  cash: number;
  card: number;
  voucher: number;
  // What partial refunds took back, by part (their total is `refunded`).
  refundedTax: number;
  refundedCard: number;
  refundedCash: number;
  // Each line, with the Day report's category for it ("Food", "Movie tickets").
  // An owner-tab order's lines are "Owner tab", at the owner price.
  lines: { name: string; qty: number; amount: number; category: string }[];
  // An owner-tab order (the monthly tab before 10/5): whose tab (first
  // name). Null for any other sale.
  ownerTab: string | null;
  // An owner-rate sale (paid at cost + 10%): whose account was on it (first
  // name). Null for any other sale. Optional: absent on older callers.
  ownerRate?: string | null;
}

// A ticket booking behind the Day report's ticket figures, and a booth
// booking behind its booth sales (both in Collected, as online money,
// except register tickets, which are inside their order).
export interface DayTicketLine {
  screeningId: string | null;
  online: boolean; // false: rung up on the register (its money is in the order)
  paid: number;
  free: number;
  revenue: number; // paid seats x price, before tax
  tax: number; // the tax Stripe added (online only; a register ticket's tax is on its order)
  at: string;
}

export interface DayBoothLine {
  fee: number;
  tax: number;
  at: string;
}

export interface DayReport extends SalesSummary {
  date: string;
  orders: DayOrder[];
  ticketLines: DayTicketLine[];
  boothLines: DayBoothLine[];
  // Insiders+ charges, gift memberships and refunds of them counted this
  // day (in Collected as their own part), oldest first.
  membershipLines: MemberPaymentLine[];
  // Owner-tab payments recorded this day (in Collected as their own part).
  ownerPaymentLines: { owner: string; month: string; amount: number; method: string; at: string }[];
}

// What a stretch of business days added up to: one day (Day), or a week or
// month (Week, Month). All of them read the same rows (loadSales) and add
// them up the same way (summarizeSales), so a week is exactly its days.
export interface SalesSummary {
  // Money in, by how it arrived: the register's cash and card, the website
  // (online tickets, booth fees, web orders), and Insiders+ and gift
  // memberships (Stripe billing). Includes tax and tips. Vouchers (trivia
  // prizes) paid for goods but brought in no money, so they're counted
  // apart from what was collected. Partial refunds on the day's orders, and
  // membership refunds, are already taken off.
  vouchers: number;
  // Gift cards (lib/gift-cards.ts): what was spent from them on orders (no
  // money in, like vouchers: the money came in when the card was sold), and
  // what cards were sold: a liability (owed as goods), not revenue, so it's
  // left out of Collected and what sold, and shown on its own "Gift cards
  // sold (owed)" line. The sale is counted when a card is spent.
  giftCardsUsed: number;
  giftCardsSold: number;
  cash: number;
  card: number;
  online: number;
  tips: number;
  tax: number; // memberships' tax included
  collected: number; // cash + card + online + memberships.collected, less gift cards sold (owed)
  // Insiders+ charges (new, renewals, switches to yearly) and gift
  // memberships, from Stripe: never orders, so never counted twice.
  memberships: MembershipTotals;
  // What was sold, before tax and tips.
  sold: { label: string; amount: number; detail?: string }[];
  discounts: number; // member, monthly member and points-reward discounts
  // Insiders+ free daily coffees given away (lib/daily-perk.ts): their menu
  // price, on completed orders, and how many. Their own line, so the cost
  // of the perk shows instead of hiding in the discounts.
  dailyCoffee: number;
  dailyCoffeeCount: number;
  // Organization comps (lib/orgs.ts): day passes and movies given at $0 to
  // an organization's people, at their price, and on how many orders.
  orgComps: number;
  orgCompOrders: number;
  // Supported guests' tax-included sales: what they paid (before tips),
  // the tax inside it, and how many orders. Their tax is already in `tax`.
  taxIncluded: { sales: number; tax: number; orders: number };
  partialRefunds: number; // goods given back on part-refunded orders, before tax
  netSales: number;
  ticketsSold: number;
  // Tickets by kind: paid online, paid at the register, and free (Insiders+
  // seats, free screenings), and what the paid ones came to before tax.
  tickets: { online: number; register: number; free: number; revenue: number };
  // Finished register and web orders, and what they came to for the goods:
  // before tax and tips, after discounts and partial refunds.
  orderCount: number;
  orderSales: number;
  // Register orders rung up tax-free, oldest first: when, how much, the tax
  // not charged, who marked it and why (lib/tax-exempt.ts).
  taxFreeOrders: TaxFreeOrder[];
  topItems: { name: string; qty: number; revenue: number; options: string }[];
  // Nathan's split for moving the day's money into the right accounts.
  accounts: { label: string; rule: string; amount: number }[];
  unassigned: number;
  ownerTab: OwnerTabSummary;
  ownerRate: OwnerRateSummary;
}

// Owner-rate sales (lib/register-totals.ts): paid at the register like any
// sale, so they're in Collected and what sold at the owner prices; this is
// the line that says how much was owner rate and who used it.
export interface OwnerRateSummary {
  orders: number; // owner-rate orders (refunded ones aren't counted)
  sales: number; // the goods at the owner rate, before tax (tickets left out: they're at menu price)
  menuValue: number; // the same goods at menu prices
  who: { name: string; orders: number }[]; // whose accounts, by first name
}

// The owner tab (lib/register-totals.ts): owner-rate sales, in what sold
// and the sales tax but not Collected, and payments against the owners'
// statements, in Collected the day they're recorded.
export interface OwnerTabSummary {
  orders: number; // owner-tab orders (refunded ones aren't counted)
  sales: number; // what the owners pay for the goods, before tax (a ticket on one is in Movie tickets)
  menuValue: number; // the same goods at menu prices
  tax: number; // sales tax on them, owed with the tab
  owed: number; // put on owner tabs: their totals, tax included
  paid: number; // owner-tab payments recorded (money in)
  payments: number;
}

// Nathan's account rules. Each is its own rule, not a split of one pot, so
// they don't add up to the day's sales. The 20/80 food-and-drink split was
// his "maybe" -- confirm with him before relying on it.
const TAX_ACCOUNT_RATE = 0.1;
const BOX_OFFICE_PER_TICKET = 4;
const INVENTORY_SHARE = 0.2;
const EXPENSE_SHARE = 0.8;

// menu_categories.key -> what the report calls it. Candy and anything
// uncategorized land in "other" rather than being folded into one of these.
const CATEGORY_BUCKET: Record<string, "food" | "coffee" | "soda" | "liquor"> = {
  grub: "food",
  caffe: "coffee",
  rad: "soda",
  beer: "liquor",
  wine: "liquor",
  cocktails: "liquor",
  shots: "liquor",
  spirits: "liquor",
};

// The category a line falls in ("What sold"). Tickets are counted from
// their bookings, not as bar sales.
type SaleLine = { menu_item_id: string | null; is_alcohol: boolean; screening_id: string | null };

function lineBucket(l: SaleLine, bucketByItem: Buckets): keyof typeof CATEGORY_LABEL {
  return l.is_alcohol ? "liquor" : (l.menu_item_id && bucketByItem.get(l.menu_item_id)) || "other";
}

// The tax-exempt columns (who marked a tax-free order, who approved it and
// why) come with "*" once their migration is in (TaxFreeOrderRow).
type DayOrderRow = Omit<TaxFreeOrderRow, "employee"> & {
  id: string;
  order_number: number;
  status: string;
  source: string;
  completed_at: string;
  order_name: string | null;
  tab_name: string | null;
  payment_method: string | null;
  payment_cash_amount: number | null;
  payment_card_amount: number | null;
  payment_voucher_amount: number | null;
  // Gift cards (20261009120000_gift_cards.sql); missing before it.
  payment_gift_card_amount?: number | null;
  subtotal: number;
  tax: number;
  tax_free: boolean;
  tip: number;
  total: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  // The Insiders+ daily coffee given away (lib/daily-perk.ts). Missing
  // until its migration (20261001230000_plus_daily_coffee.sql) is applied.
  daily_perk_discount?: number | null;
  // The owner tab (payment_method 'owner_tab'): whose, and the menu value
  // it replaced. Missing until 20261003060000_owner_tab.sql is applied.
  owner_tab_employee_id?: string | null;
  owner_menu_value?: number | null;
  // Organization accounts (20261005040000_organizations.sql); missing before it.
  org_comp_discount?: number | null;
  tax_included?: boolean | null;
  stripe_payment_intent_id: string | null;
  employee_id: string | null;
  employee: { name: string } | null;
  // The member on it (an owner-rate sale: the owner's account). Optional:
  // a caller's rows may not have it.
  member?: { name: string } | null;
  items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; menu_item_id: string | null; is_alcohol: boolean; screening_id: string | null }[];
};

const isOwnerTab = (o: { payment_method: string | null }) => o.payment_method === "owner_tab";
// A sale paid at the owner rate: it keeps the menu value it replaced.
const isOwnerRate = (o: { payment_method: string | null; owner_menu_value?: number | null }) => !isOwnerTab(o) && o.owner_menu_value !== null && o.owner_menu_value !== undefined;
const ownerRateName = (o: { member?: { name: string } | null }) => String(o.member?.name ?? "").trim().split(/\s+/)[0] || "an owner";

// First names of the owners whose tabs these orders went on (and of anyone
// else named), for the Orders table. Best effort: empty if it can't be read.
async function firstNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await createAdminClient().from("employees").select("id, name").in("id", want);
  return new Map((data ?? []).map((e) => [e.id as string, String(e.name ?? "").trim().split(/\s+/)[0] || "owner"]));
}

// The cashier join names its foreign key: since the manager-PIN migration,
// orders has two links to employees (who rang it up, and refund_approved_by),
// and a bare employees(name) fails with "more than one relationship".
// The order's own columns are "*", so the reports keep working before the
// daily coffee's migration adds daily_perk_discount.
const DAY_ORDER_COLUMNS =
  "*, employee:employees!orders_employee_id_fkey(name), member:members(name), items:order_items(name, quantity, unit_price, modifiers, menu_item_id, is_alcohol, screening_id)";

type RefundedParts = { amount: number; tax: number; card: number; cash: number };
const NOTHING_REFUNDED: RefundedParts = { amount: 0, tax: 0, card: 0, cash: 0 };

// One order as the Orders table shows it. `parts` is what partial refunds
// have given back so far. `owners`: first names, for an owner-tab order.
function toDayOrder(o: DayOrderRow, parts: RefundedParts, bucketByItem: Buckets, owners: Map<string, string> = new Map()): DayOrder {
  const refunded = parts.amount;
  const owner = isOwnerTab(o) ? (owners.get(o.owner_tab_employee_id ?? "") ?? "owner") : null;
  return {
    id: o.id,
    orderNumber: Number(o.order_number),
    status: o.status,
    at: o.completed_at,
    cashier: o.employee?.name ?? null,
    name: o.tab_name || o.order_name || null,
    items: o.items.map((l) => (l.quantity > 1 ? `${l.quantity} ${l.name}` : l.name)).join(", "),
    // "cash + voucher" when vouchers paid part of it.
    method: owner
      ? `owner tab (${owner})`
      : `${Number(o.payment_voucher_amount) > 0 && o.payment_method !== "voucher" ? `${o.payment_method} + voucher` : o.payment_method}${isOwnerRate(o) ? ` · owner rate (${ownerRateName(o)})` : ""}`,
    tip: Number(o.tip),
    total: Number(o.total),
    refunded,
    // What a partial refund can still give back (src/lib/data/refund-plan.ts).
    refundable:
      o.status === "completed"
        ? mostRefundable(
            { source: o.source, tax: Number(o.tax), tip: Number(o.tip), total: Number(o.total), cash: Number(o.payment_cash_amount ?? 0), card: Number(o.payment_card_amount ?? 0) },
            { amount: refunded, tax: 0, card: 0 },
          )
        : 0,
    paidByCard: !!o.stripe_payment_intent_id,
    businessDate: businessDay(new Date(o.completed_at)).date,
    source: o.source,
    cashierId: o.employee_id,
    tax: Number(o.tax),
    taxFree: !!o.tax_free,
    cash: Number(o.payment_cash_amount ?? 0),
    card: Number(o.payment_card_amount ?? 0),
    voucher: Number(o.payment_voucher_amount ?? 0),
    refundedTax: parts.tax,
    refundedCard: parts.card,
    refundedCash: parts.cash,
    lines: o.items.map((l) => ({
      name: l.name,
      qty: l.quantity,
      amount: Number(l.unit_price) * l.quantity,
      category: l.screening_id ? TICKETS_LABEL : owner ? OWNER_TAB_LABEL : CATEGORY_LABEL[lineBucket(l, bucketByItem)],
    })),
    ownerTab: owner,
    ownerRate: isOwnerRate(o) ? ownerRateName(o) : null,
  };
}

function partsByOrder(partials: PartialRefundRow[]): Map<string, RefundedParts> {
  const out = new Map<string, RefundedParts>();
  for (const p of partials) {
    const s = out.get(p.order_id) ?? { ...NOTHING_REFUNDED };
    s.amount = round2(s.amount + Number(p.amount));
    s.tax = round2(s.tax + Number(p.tax_amount));
    s.card = round2(s.card + Number(p.card_amount));
    s.cash = round2(s.cash + Number(p.cash_amount));
    out.set(p.order_id, s);
  }
  return out;
}

// Who may see an owner's name and amounts: owners only. Managers and admins
// get "Owner tab" and its totals, never whose or what (the order's lines,
// its total, the payments' names and amounts). The default is the safe one:
// a caller that doesn't say who is looking gets the redacted report.
export const OWNER_TAB_HIDDEN = "an owner";
export const mayViewOwnerTab = (viewer?: { role?: string | null } | null) => viewer?.role === "owner";

export function redactOwnerOrder(o: DayOrder): DayOrder {
  if (!o.ownerTab) return o;
  return { ...o, ownerTab: OWNER_TAB_HIDDEN, items: OWNER_TAB_LABEL, lines: [], total: 0, refunded: 0, refundable: 0, cash: 0, card: 0, voucher: 0, refundedTax: 0, refundedCard: 0, refundedCash: 0 };
}

export async function getDayReport(date: string, viewer?: { role?: string | null } | null): Promise<DayReport> {
  const { start, end } = businessDayWindow(date);
  const { rows, buckets } = await loadSales(start, end);
  const refundedByOrder = partsByOrder(rows.partials);
  const seeOwners = mayViewOwnerTab(viewer);
  // Not even read for anyone else.
  const names = seeOwners ? await firstNames([...rows.orders.filter(isOwnerTab).map((o) => o.owner_tab_employee_id), ...rows.ownerPayments.map((p) => p.owner_id)]) : new Map<string, string>();
  return {
    date,
    orders: rows.orders.map((o) => {
      const order = toDayOrder(o, refundedByOrder.get(o.id) ?? NOTHING_REFUNDED, buckets, names);
      return seeOwners ? order : redactOwnerOrder(order);
    }),
    ownerPaymentLines: (seeOwners ? [...rows.ownerPayments] : [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({ owner: names.get(p.owner_id) ?? "owner", month: p.month, amount: Number(p.amount), method: p.method, at: p.created_at })),
    // The same seats and money summarizeSales counts (bookingSeats), one per booking.
    ticketLines: rows.bookings.map((b) => {
      const { paid, free } = bookingSeats(b);
      return { screeningId: b.screening_id, online: !b.order_id, paid, free, revenue: paid * Number(b.unit_price), tax: b.order_id ? 0 : Number(b.tax_amount), at: b.created_at };
    }),
    boothLines: rows.booths.map((r) => ({ fee: Number(r.fee_amount), tax: Number(r.tax_amount ?? 0), at: r.created_at })),
    membershipLines: [...rows.memberships].sort((a, b) => a.counted_at.localeCompare(b.counted_at) || a.paid_at.localeCompare(b.paid_at)).map(paymentLine),
    ...summarizeSales(rows, buckets),
  };
}

// ---------- the rows behind a stretch of days ----------

type SaleBooking = { quantity: number; unit_price: number; tax_amount: number; order_id: string | null; created_at: string; screening_id: string | null };
type SaleBooth = { fee_amount: number; tax_amount: number | null; created_at: string };

export interface SalesRows {
  orders: DayOrderRow[]; // finished, refunded and voided, newest first
  bookings: SaleBooking[]; // confirmed tickets, online and register, by when sold
  booths: SaleBooth[];
  partials: PartialRefundRow[]; // on completed orders sold in the range
  memberships: MemberPaymentRecord[]; // Insiders+ and gift payments and their refunds, by the day counted
  membershipsTracked: boolean; // false until the member payments migration is applied
  ownerPayments: OwnerPaymentRow[]; // payments against owner-tab statements, by the day recorded
}

export type OwnerPaymentRow = { owner_id: string; month: string; amount: number; method: string; created_at: string };

// Owner-tab payments recorded between two instants. Empty (not an error)
// until 20261003060000_owner_tab.sql is applied.
export async function getOwnerTabPayments(start: string, end: string | null): Promise<OwnerPaymentRow[]> {
  const supabase = createAdminClient();
  try {
    return await fetchAll<OwnerPaymentRow>((from, to) => {
      let q = supabase.from("owner_tab_payments").select("owner_id, month, amount, method, created_at").gte("created_at", start);
      if (end) q = q.lt("created_at", end);
      return q.order("id").range(from, to);
    });
  } catch {
    return [];
  }
}

// menu item -> the report's category for it (undefined: candy and other).
export type Buckets = Map<string, "food" | "coffee" | "soda" | "liquor" | undefined>;

// Everything sold between two instants (business-day edges), paged.
export async function loadSales(start: string, end: string): Promise<{ rows: SalesRows; buckets: Buckets }> {
  const supabase = createAdminClient();
  const [orders, bookings, booths, buckets, partials, memberships, ownerPayments] = await Promise.all([
    fetchAll<DayOrderRow>((from, to) =>
      supabase
        .from("orders")
        .select(DAY_ORDER_COLUMNS)
        .in("status", ["completed", "refunded", "voided"])
        .gte("completed_at", start)
        .lt("completed_at", end)
        .order("completed_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    // Every ticket, online or at the register, has a booking.
    fetchAll<SaleBooking>((from, to) =>
      supabase.from("bookings").select("quantity, unit_price, tax_amount, order_id, created_at, screening_id").eq("status", "confirmed").gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    fetchAll<SaleBooth>((from, to) =>
      supabase.from("booth_reservations").select("fee_amount, tax_amount, created_at").eq("status", "confirmed").gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    loadBuckets(),
    getPartialRefunds(start, end),
    getMemberPaymentsBetween(start, end),
    getOwnerTabPayments(start, end),
  ]);
  await attachTaxExemptNames(orders);
  return { rows: { orders, bookings, booths, partials, memberships: memberships.rows, membershipsTracked: memberships.tracked, ownerPayments }, buckets };
}

// Each menu item's category, as the report groups them.
async function loadBuckets(): Promise<Buckets> {
  const supabase = createAdminClient();
  const [menuRes, catRes] = await Promise.all([supabase.from("menu_items").select("id, category_id"), supabase.from("menu_categories").select("id, key")]);
  for (const r of [menuRes, catRes]) if (r.error) throw r.error;
  const categoryKeyById = new Map((catRes.data ?? []).map((c) => [c.id, c.key]));
  return new Map((menuRes.data ?? []).map((m) => [m.id, CATEGORY_BUCKET[categoryKeyById.get(m.category_id) ?? ""]]));
}

// The rows split by the business day each belongs to: an order by when it
// was finished, a ticket or booth by when it was sold, a partial refund by
// its order's day (refunds come off the day of the sale), and a membership
// payment by the day it was counted (a refund of one: its payment's day).
export function salesByDay(rows: SalesRows): Map<string, SalesRows> {
  const days = new Map<string, SalesRows>();
  const byDate = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { orders: [], bookings: [], booths: [], partials: [], memberships: [], membershipsTracked: rows.membershipsTracked, ownerPayments: [] }));
    return d;
  };
  const day = (iso: string) => byDate(businessDay(new Date(iso)).date);
  for (const o of rows.orders) day(o.completed_at).orders.push(o);
  for (const b of rows.bookings) day(b.created_at).bookings.push(b);
  for (const r of rows.booths) day(r.created_at).booths.push(r);
  for (const p of rows.partials) day(p.orders.completed_at).partials.push(p);
  for (const m of rows.memberships) byDate(m.business_date).memberships.push(m);
  for (const p of rows.ownerPayments) day(p.created_at).ownerPayments.push(p);
  return days;
}

// The Day report's arithmetic, for any set of rows.
export function summarizeSales(rows: SalesRows, bucketByItem: Buckets): SalesSummary {
  const { orders, bookings, booths, partials } = rows;
  const completed = orders.filter((o) => o.status === "completed");
  const boothRevenue = booths.reduce((s, r) => s + Number(r.fee_amount), 0);
  // Booth bookings carry the sales tax Stripe added (since 9/29), which was collected with the fee.
  const boothTax = booths.reduce((s, r) => s + Number(r.tax_amount ?? 0), 0);

  let vouchers = 0,
    giftCardsUsed = 0,
    giftCardsSold = 0,
    cash = 0,
    card = 0,
    online = 0,
    tips = 0,
    tax = 0,
    discounts = 0,
    dailyCoffee = 0,
    dailyCoffeeCount = 0,
    orgComps = 0,
    orgCompOrders = 0;
  const taxIncluded = { sales: 0, tax: 0, orders: 0 };
  const category = { food: 0, coffee: 0, soda: 0, liquor: 0, other: 0 };
  const ownerTab: OwnerTabSummary = { orders: 0, sales: 0, menuValue: 0, tax: 0, owed: 0, paid: 0, payments: 0 };
  const ownerRate = { orders: 0, sales: 0, menuValue: 0, who: new Map<string, number>() };
  const items = new Map<string, { qty: number; revenue: number; options: Map<string, number> }>();
  for (const o of completed) {
    // An owner-tab order took no money (its cash and card are 0), so it
    // adds nothing to Collected: its goods are their own line in what sold,
    // and its tax is owed with the tab.
    const owner = isOwnerTab(o);
    if (o.source === "pos") {
      cash += Number(o.payment_cash_amount ?? 0);
      card += Number(o.payment_card_amount ?? 0);
      vouchers += Number(o.payment_voucher_amount ?? 0);
      giftCardsUsed += Number(o.payment_gift_card_amount ?? 0);
    } else online += Number(o.total);
    tips += Number(o.tip);
    tax += Number(o.tax);
    discounts += Number(o.tier_discount) + Number(o.monthly_discount) + Number(o.redemption_discount);
    const coffee = Number(o.daily_perk_discount ?? 0);
    if (coffee > 0) {
      dailyCoffee += coffee;
      dailyCoffeeCount++;
    }
    if (owner) {
      // A ticket on it is at its normal price both ways, and counted with
      // the tickets below.
      const tickets = o.items.filter((l) => l.screening_id).reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0);
      ownerTab.orders++;
      ownerTab.tax += Number(o.tax);
      ownerTab.owed += Number(o.total);
      ownerTab.menuValue += Number(o.owner_menu_value ?? o.subtotal) - tickets;
    } else if (isOwnerRate(o)) {
      // Paid like any sale (in Collected, its goods in their categories at
      // the owner prices); counted here too, for the Owner rate line. A
      // ticket on it is at its normal price both ways, so it's left out.
      const tickets = o.items.filter((l) => l.screening_id).reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0);
      const goods = o.items.filter((l) => !l.screening_id).reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0);
      ownerRate.orders++;
      ownerRate.sales += goods;
      ownerRate.menuValue += Number(o.owner_menu_value) - tickets;
      const who = ownerRateName(o);
      ownerRate.who.set(who, (ownerRate.who.get(who) ?? 0) + 1);
    }
    const comp = Number(o.org_comp_discount ?? 0);
    if (comp > 0) {
      orgComps += comp;
      orgCompOrders++;
    }
    if (o.tax_included) {
      taxIncluded.sales += Number(o.total) - Number(o.tip);
      taxIncluded.tax += Number(o.tax);
      taxIncluded.orders++;
    }
    for (const l of o.items) {
      const amount = Number(l.unit_price) * l.quantity;
      // Tickets are counted from their bookings below, not as bar sales.
      if (!l.screening_id) {
        if (owner) ownerTab.sales += amount;
        else if (isGiftCardLine(l)) giftCardsSold += amount;
        else category[lineBucket(l, bucketByItem)] += amount;
      }
      const it = items.get(l.name) ?? { qty: 0, revenue: 0, options: new Map() };
      it.qty += l.quantity;
      it.revenue += amount;
      for (const m of l.modifiers ?? []) it.options.set(m, (it.options.get(m) ?? 0) + l.quantity);
      items.set(l.name, it);
    }
  }

  const ticketsSold = bookings.reduce((s, b) => s + b.quantity, 0);
  const tickets = { online: 0, register: 0, free: 0, revenue: 0 };
  // Tickets rung on an owner's tab: sold at their price, but not box office ($4 a ticket is for paid tickets).
  const ownerTabOrderIds = new Set(completed.filter(isOwnerTab).map((o) => o.id));
  let ownerTabTickets = 0;
  let onlineTicketRevenue = 0;
  for (const b of bookings) {
    const { paid, free } = bookingSeats(b);
    const revenue = paid * Number(b.unit_price);
    tickets[b.order_id ? "register" : "online"] += paid;
    if (b.order_id && ownerTabOrderIds.has(b.order_id)) ownerTabTickets += paid;
    tickets.free += free;
    tickets.revenue += revenue;
    if (!b.order_id) onlineTicketRevenue += revenue;
  }
  const paidTickets = tickets.online + tickets.register;
  const boxOfficeTickets = paidTickets - ownerTabTickets;
  const ticketRevenue = tickets.revenue;
  // Online tickets: price plus the sales tax Stripe added (register tickets'
  // tax is already in their order).
  const onlineTicketTax = bookings.filter((b) => !b.order_id).reduce((s, b) => s + Number(b.tax_amount), 0);
  online += onlineTicketRevenue + onlineTicketTax + boothRevenue + boothTax;
  tax += onlineTicketTax + boothTax;

  // Partial refunds on today's orders come off the money in, the way it went back.
  let partialRefunds = 0;
  for (const p of partials) {
    if (p.orders.source === "pos") {
      cash -= Number(p.cash_amount);
      card -= Number(p.card_amount);
    } else online -= Number(p.amount);
    tax -= Number(p.tax_amount);
    partialRefunds += Number(p.amount) - Number(p.tax_amount);
  }
  // What the orders came to for the goods (the average order is this over the count).
  // Gift cards sold aren't sales (they're owed until spent).
  const orderSales = completed.reduce((s, o) => s + Number(o.total) - Number(o.tax) - Number(o.tip), 0) - partialRefunds - giftCardsSold;

  // Insiders+ and gift memberships: their own part of the money in (never
  // an order, so nothing here is also counted above), their tax, and a line
  // in what sold, with their refunds already taken off.
  const memberships = summarizeMemberships(rows.memberships, rows.membershipsTracked);
  tax += memberships.tax;
  const membershipsLine = membershipsDetail(memberships);

  // Payments against the owners' statements: money in, the day recorded.
  for (const p of rows.ownerPayments ?? []) {
    ownerTab.paid += Number(p.amount);
    ownerTab.payments++;
  }

  const sold = [
    { label: TICKETS_LABEL, amount: ticketRevenue, detail: ticketsSold ? `${ticketsSold} sold${ticketsSold > paidTickets ? `, ${ticketsSold - paidTickets} free` : ""}` : undefined },
    { label: CATEGORY_LABEL.food, amount: category.food },
    { label: CATEGORY_LABEL.other, amount: category.other },
    { label: CATEGORY_LABEL.soda, amount: category.soda },
    { label: CATEGORY_LABEL.coffee, amount: category.coffee },
    { label: CATEGORY_LABEL.liquor, amount: category.liquor },
    { label: BOOTHS_LABEL, amount: boothRevenue },
    { label: MEMBERSHIPS_LABEL, amount: memberships.sales, detail: membershipsLine || undefined },
    // At what the owners pay, with the menu value it replaced beside it.
    {
      label: OWNER_TAB_LABEL,
      amount: ownerTab.sales,
      detail: ownerTab.orders ? `${ownerTab.orders} order${ownerTab.orders === 1 ? "" : "s"} at cost, menu value ${money(ownerTab.menuValue)}` : undefined,
    },
  ].filter((r) => r.amount > 0 || r.detail);
  const grossSales = sold.reduce((s, r) => s + r.amount, 0);
  const foodAndDrink = category.food + category.coffee + category.soda + category.liquor;

  return {
    vouchers,
    giftCardsUsed,
    giftCardsSold,
    cash,
    card,
    online,
    tips,
    tax,
    // Gift cards sold are owed, not revenue: their own line, not in Collected.
    collected: cash + card + online + memberships.collected + ownerTab.paid - giftCardsSold,
    memberships,
    sold,
    discounts,
    dailyCoffee,
    dailyCoffeeCount,
    orgComps,
    orgCompOrders,
    taxIncluded,
    partialRefunds,
    // A tax-included sale's prices hold its tax, so that comes out of what
    // sold too: a $4.00 pizza is $3.68 of sales and $0.32 of tax.
    netSales: grossSales - discounts - dailyCoffee - orgComps - taxIncluded.tax - partialRefunds,
    ticketsSold,
    tickets,
    orderCount: completed.length,
    taxFreeOrders: taxFreeOrders(completed),
    orderSales,
    topItems: [...items.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([name, v]) => ({
        name,
        qty: v.qty,
        revenue: v.revenue,
        options: [...v.options.entries()]
          .sort((a, b) => b[1] - a[1])
          // "×n" only when the choice split: "Root beer ×2 · Coke ×2".
          .map(([m, n]) => (n === v.qty ? m : `${m} ×${n}`))
          .join(" · "),
      })),
    accounts: [
      { label: "Tax account", rule: `10% of ${money(grossSales)} sold`, amount: grossSales * TAX_ACCOUNT_RATE },
      { label: "Box office", rule: `$4 × ${boxOfficeTickets} paid ticket${boxOfficeTickets === 1 ? "" : "s"}${ownerTabTickets ? ` (not the ${ownerTabTickets} on owner tabs)` : ""}`, amount: boxOfficeTickets * BOX_OFFICE_PER_TICKET },
      { label: "Inventory", rule: `20% of ${money(foodAndDrink)} food & drink`, amount: foodAndDrink * INVENTORY_SHARE },
      { label: "Expenses", rule: `80% of ${money(foodAndDrink)} food & drink`, amount: foodAndDrink * EXPENSE_SHARE },
    ],
    // Sales none of the rules above claims: ticket and booth money past the
    // $4 carve-out, candy/other, memberships and the owner tab (which the
    // Tax account's 10% of everything sold does count). The owner tab isn't
    // food and drink money here: none came in yet.
    unassigned: ticketRevenue - boxOfficeTickets * BOX_OFFICE_PER_TICKET + boothRevenue + category.other + memberships.sales + ownerTab.sales,
    ownerTab: {
      ...ownerTab,
      sales: round2(ownerTab.sales),
      menuValue: round2(ownerTab.menuValue),
      tax: round2(ownerTab.tax),
      owed: round2(ownerTab.owed),
      paid: round2(ownerTab.paid),
    },
    ownerRate: {
      orders: ownerRate.orders,
      sales: round2(ownerRate.sales),
      menuValue: round2(ownerRate.menuValue),
      who: [...ownerRate.who.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, orders]) => ({ name, orders })),
    },
  };
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// ---------- trend ----------

export interface RevenueDay {
  date: string;
  register: number;
  online: number;
  memberships: number;
  ownerTab: number; // owner-tab payments recorded that day
  total: number;
}

// Money in per business day (register + website + memberships), oldest
// first, with empty days included so the chart's days line up.
export async function getRevenueTrend(days: number): Promise<RevenueDay[]> {
  const supabase = createAdminClient();
  const dates = recentBusinessDays(days).reverse();
  const { start } = businessDayWindow(dates[0]);

  // Paged: 90 days of orders is well past the database's 1,000-row answer.
  const [orders, bookings, booths, partials, memberships, ownerPayments] = await Promise.all([
    fetchAll<{ total: number; source: string; completed_at: string; payment_method: string | null }>((from, to) =>
      supabase.from("orders").select("total, source, completed_at, payment_method").eq("status", "completed").gte("completed_at", start).order("id").range(from, to),
    ),
    // Register tickets are already inside their order's total.
    fetchAll<{ quantity: number; unit_price: number; tax_amount: number; created_at: string }>((from, to) =>
      supabase.from("bookings").select("quantity, unit_price, tax_amount, created_at").eq("status", "confirmed").is("order_id", null).gte("created_at", start).order("id").range(from, to),
    ),
    fetchAll<{ fee_amount: number; tax_amount: number | null; created_at: string }>((from, to) =>
      supabase.from("booth_reservations").select("fee_amount, tax_amount, created_at").eq("status", "confirmed").gte("created_at", start).order("id").range(from, to),
    ),
    getPartialRefunds(start, null),
    getMemberPaymentsBetween(start, null),
    getOwnerTabPayments(start, null),
  ]);

  const byDay = new Map(dates.map((d) => [d, { register: 0, online: 0, memberships: 0, ownerTab: 0 }]));
  const add = (iso: string, key: "register" | "online" | "ownerTab", amount: number) => {
    const entry = byDay.get(businessDay(new Date(iso)).date);
    if (entry) entry[key] += amount;
  };
  // An owner-tab order took no money; its payment counts the day it's recorded.
  for (const o of orders) if (!isOwnerTab(o)) add(o.completed_at, o.source === "pos" ? "register" : "online", Number(o.total));
  for (const p of ownerPayments) add(p.created_at, "ownerTab", Number(p.amount));
  for (const b of bookings) add(b.created_at, "online", bookingSeats(b).paid * Number(b.unit_price) + Number(b.tax_amount));
  for (const r of booths) add(r.created_at, "online", Number(r.fee_amount) + Number(r.tax_amount ?? 0));
  // A partial refund comes off the day of the sale, like the Day view.
  for (const p of partials) add(p.orders.completed_at, p.orders.source === "pos" ? "register" : "online", -Number(p.amount));
  // Memberships on the day they're counted (a refund: its payment's day).
  for (const m of memberships.rows) {
    const entry = byDay.get(m.business_date);
    if (entry) entry.memberships += m.amount_cents / 100;
  }

  return [...byDay.entries()].map(([date, v]) => ({ date, ...v, total: v.register + v.online + v.memberships + v.ownerTab }));
}

export interface MembershipAnalytics {
  total: number;
  insiders: number;
  insidersPlus: number;
  payingInsidersPlus: number;
  compedMembers: number;
  newThisMonth: number;
  byProgram: { program: string; count: number }[];
}

// Membership mix plus a breakdown of comped (free) members by community
// program, for nonprofit grant/impact reporting -- e.g. "N members are
// receiving free access through the Community Access Program."
export async function getMembershipAnalytics(): Promise<MembershipAnalytics> {
  const supabase = createAdminClient();
  type Row = {
    tier: string;
    comped: boolean;
    stripe_subscription_id: string | null;
    subscription_status: string | null;
    created_at: string;
    legacy_user_id: number | null;
    community_program: { name: string } | null;
  };
  // Paged: the database returns at most 1,000 rows per request, and there
  // are more members than that since the old-site import.
  const members: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("members")
      .select("tier, comped, stripe_subscription_id, subscription_status, created_at, legacy_user_id, community_program:community_programs(name)")
      .is("erased_at", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    members.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  // The first of this month, Central (the server's own clock is UTC).
  const startOfMonth = new Date(businessDayWindow(`${centralDate().slice(0, 7)}-01`).start);

  const programTally = new Map<string, number>();
  let insiders = 0,
    insidersPlus = 0,
    payingInsidersPlus = 0,
    compedMembers = 0,
    newThisMonth = 0;

  for (const m of members) {
    if (m.tier === "Insiders+") {
      insidersPlus++;
      // A Stripe subscription still billing them (a cancelled one keeps its id).
      if (subscriptionLive(m)) payingInsidersPlus++;
    } else {
      insiders++;
    }
    if (m.comped) {
      compedMembers++;
      const program = m.community_program?.name ?? "Unspecified program";
      programTally.set(program, (programTally.get(program) ?? 0) + 1);
    }
    // Accounts moved over from the old site didn't join this month.
    if (new Date(m.created_at) >= startOfMonth && m.legacy_user_id === null) newThisMonth++;
  }

  return {
    total: members.length,
    insiders,
    insidersPlus,
    payingInsidersPlus,
    compedMembers,
    newThisMonth,
    byProgram: [...programTally.entries()].map(([program, count]) => ({ program, count })).sort((a, b) => b.count - a.count),
  };
}

export interface AlcoholUsageRow {
  ingredientId: string;
  name: string;
  unit: string;
  theoreticalUsage: number;
  physicalUsage: number | null;
  variance: number | null;
  unitCost: number | null;
  theoreticalCost: number | null;
  physicalCost: number | null;
  varianceCost: number | null;
}

// Compares recipe-based "theoretical" ingredient usage (recipe quantity x
// drinks sold in range) against physical stock depletion (earliest count at
// or before the range start minus the latest count overall) to surface
// overpour/waste per ingredient. physicalUsage/variance stay null when
// there isn't a count bracketing the range yet -- can't tell real usage
// from theoretical alone, and showing a fabricated number would be worse
// than showing nothing.
export async function getAlcoholUsageReport(days: number): Promise<AlcoholUsageRow[]> {
  const supabase = createAdminClient();
  // The last `days` business days, the same range the Day view's trend uses.
  const dates = recentBusinessDays(days);
  const since = new Date(businessDayWindow(dates[dates.length - 1]).start);
  const now = new Date();

  // Paged, and read in one go through the order (a list of thousands of
  // order ids used to be pasted into a second request, after the first had
  // already stopped at 1,000 orders).
  const [{ data: ingredients, error: ingErr }, orderItems, counts, recipesByItem, { data: drinks, error: drinkErr }, notCarriedRead, bookSold] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit, unit_cost").eq("active", true).order("category").order("name"),
    fetchAll<{ menu_item_id: string | null; quantity: number; modifiers: string[] | null }>((from, to) =>
      supabase
        .from("order_items")
        .select("menu_item_id, quantity, modifiers, orders!inner(status, completed_at)")
        .eq("orders.status", "completed")
        .gte("orders.completed_at", since.toISOString())
        .not("menu_item_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    fetchAll<{ ingredient_id: string; quantity_on_hand: number; counted_at: string }>((from, to) =>
      supabase.from("inventory_counts").select("ingredient_id, quantity_on_hand, counted_at").order("counted_at").order("id").range(from, to),
    ),
    getRecipesByItem(),
    supabase.from("menu_items").select("id").eq("is_alcohol", true),
    // Ingredients the bar doesn't carry (the Bar Book's starter list adds
    // them). An error, like before the Bar Book migration, means none.
    supabase.from("ingredients").select("id").eq("carried", false),
    // Bar Book drinks rung up off the menu, poured from their recipe.
    bookDrinkLines(since),
  ]);
  const [customSold, prices] = await Promise.all([customDrinkLines(since), getBarPrices()]);
  if (ingErr) throw ingErr;
  if (drinkErr) throw drinkErr;
  const notCarried = new Set(notCarriedRead.error ? [] : (notCarriedRead.data ?? []).map((i) => i.id as string));

  // The bar only. Food has recipes too (a hot dog's bun, popcorn kernels),
  // so "Ran out" knows which buttons to stop; those amounts are placeholders
  // and those ingredients stay off this report.
  const drinkIds = new Set((drinks ?? []).map((d) => d.id as string));
  const barIngredients = new Set<string>();
  const foodIngredients = new Set<string>();
  for (const [itemId, recipe] of Object.entries(recipesByItem)) {
    for (const ri of recipe.ingredients) (drinkIds.has(itemId) ? barIngredients : foodIngredients).add(ri.ingredient_id);
  }

  const theoreticalByIngredient = new Map<string, number>();
  // A double (lib/bar/double.ts) pours its base-spirit lines twice; a shot
  // poured neat or on the rocks pours the neat pour (2 oz, twice that
  // doubled).
  const pour = (lines: { ingredient_id: string; quantity: number; name: string; unit?: string | null; kind?: string | null; optional?: boolean }[], times: number, double: boolean, pourOz: number | null = null) => {
    for (const ri of pouredLines(lines, { double, pourOz })) {
      theoreticalByIngredient.set(ri.ingredient_id, (theoreticalByIngredient.get(ri.ingredient_id) ?? 0) + ri.quantity * times);
    }
  };
  for (const oi of orderItems) {
    const recipe = oi.menu_item_id && drinkIds.has(oi.menu_item_id) ? recipesByItem[oi.menu_item_id] : undefined;
    if (!recipe) continue;
    pour(
      recipe.ingredients.map((ri) => ({ ingredient_id: ri.ingredient_id, quantity: ri.quantity, name: ri.ingredient_name, unit: ri.unit, kind: ri.kind ?? null, optional: ri.optional === true })),
      oi.quantity,
      isDouble(oi.modifiers),
      serveOf(oi.modifiers) ? prices.pours.neat : null,
    );
  }
  // A Bar Book drink pours its own recipe, the same way.
  for (const sold of bookSold.sold) {
    const lines = bookSold.recipes.get(sold.recipe_id) ?? [];
    for (const ri of lines) barIngredients.add(ri.ingredient_id);
    pour(lines, sold.quantity, isDouble(sold.modifiers));
  }
  // And a custom drink pours what its list says.
  for (const sold of customSold) {
    if (!Array.isArray(sold.custom_recipe)) continue;
    const lines = (sold.custom_recipe as { ingredient_id?: unknown; quantity?: unknown; name?: unknown; kind?: unknown }[]).flatMap((ri) => {
      const id = typeof ri?.ingredient_id === "string" ? ri.ingredient_id : null;
      const q = Number(ri?.quantity);
      if (!id || !Number.isFinite(q) || q <= 0) return [];
      return [{ ingredient_id: id, quantity: q, name: typeof ri.name === "string" ? ri.name : "", kind: typeof ri.kind === "string" ? ri.kind : null }];
    });
    for (const ri of lines) barIngredients.add(ri.ingredient_id);
    pour(lines, sold.quantity, isDouble(sold.modifiers));
  }

  const countsByIngredient = new Map<string, { quantity_on_hand: number; counted_at: string }[]>();
  for (const c of counts) {
    const list = countsByIngredient.get(c.ingredient_id) ?? [];
    list.push({ quantity_on_hand: Number(c.quantity_on_hand), counted_at: c.counted_at });
    countsByIngredient.set(c.ingredient_id, list);
  }

  function latestAtOrBefore(list: { quantity_on_hand: number; counted_at: string }[], cutoff: Date) {
    let best: { quantity_on_hand: number; counted_at: string } | null = null;
    for (const c of list) {
      if (new Date(c.counted_at) <= cutoff && (!best || new Date(c.counted_at) > new Date(best.counted_at))) best = c;
    }
    return best;
  }

  // Not-carried ingredients no menu drink uses and nobody counts stay off.
  const rows: AlcoholUsageRow[] = (ingredients ?? [])
    .filter((ing) => barIngredients.has(ing.id) || !foodIngredients.has(ing.id))
    .filter((ing) => !notCarried.has(ing.id) || barIngredients.has(ing.id) || countsByIngredient.has(ing.id))
    .map((ing) => {
    const list = countsByIngredient.get(ing.id) ?? [];
    const startCount = latestAtOrBefore(list, since);
    const endCount = latestAtOrBefore(list, now);
    const theoreticalUsage = theoreticalByIngredient.get(ing.id) ?? 0;
    const physicalUsage = startCount && endCount && endCount.counted_at !== startCount.counted_at ? startCount.quantity_on_hand - endCount.quantity_on_hand : null;
    const variance = physicalUsage !== null ? physicalUsage - theoreticalUsage : null;
    const unitCost = ing.unit_cost !== null ? Number(ing.unit_cost) : null;
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      theoreticalUsage,
      physicalUsage,
      variance,
      unitCost,
      theoreticalCost: unitCost !== null ? theoreticalUsage * unitCost : null,
      physicalCost: unitCost !== null && physicalUsage !== null ? physicalUsage * unitCost : null,
      varianceCost: unitCost !== null && variance !== null ? variance * unitCost : null,
    };
  });

  // Ingredients with a known $ variance sort to the top, worst overpour
  // first -- that's what actually needs attention. Everything else falls
  // back to theoretical usage so the list stays meaningful before any costs
  // are entered.
  return rows.sort((a, b) => {
    if (a.varianceCost !== null || b.varianceCost !== null) return (b.varianceCost ?? -Infinity) - (a.varianceCost ?? -Infinity);
    return b.theoreticalUsage - a.theoreticalUsage;
  });
}

// Bar Book drinks sold off the menu since `since` (order_items.recipe_id,
// migration 20261004030000), and their recipes' lines. Empty before that
// migration, or if it can't be read: the report then reads as before.
type BookLineRow = { ingredient_id: string; quantity: number; name: string; kind: string | null; optional: boolean };
type BookSold = { sold: { recipe_id: string; name: string; quantity: number; unit_price: number; modifiers: string[] | null }[]; recipes: Map<string, BookLineRow[]> };

async function bookDrinkLines(since: Date): Promise<BookSold> {
  const none: BookSold = { sold: [], recipes: new Map() };
  const supabase = createAdminClient();
  try {
    const sold = await fetchAll<{ recipe_id: string; name: string; quantity: number; unit_price: number; modifiers: string[] | null }>((from, to) =>
      supabase
        .from("order_items")
        .select("recipe_id, name, quantity, unit_price, modifiers, orders!inner(status, completed_at)")
        .eq("orders.status", "completed")
        .gte("orders.completed_at", since.toISOString())
        .not("recipe_id", "is", null)
        .order("id")
        .range(from, to),
    );
    const ids = [...new Set(sold.map((l) => l.recipe_id))];
    if (!ids.length) return { sold, recipes: new Map() };
    const { data, error } = await supabase.from("recipe_ingredients").select("recipe_id, ingredient_id, quantity, optional, ingredient:ingredients(name, kind)").in("recipe_id", ids);
    if (error) return { sold, recipes: new Map() };
    const recipes = new Map<string, BookLineRow[]>();
    for (const r of (data ?? []) as unknown as { recipe_id: string; ingredient_id: string; quantity: number; optional: boolean | null; ingredient: { name: string; kind: string | null } | null }[]) {
      const line: BookLineRow = { ingredient_id: r.ingredient_id, quantity: Number(r.quantity), name: r.ingredient?.name ?? "", kind: r.ingredient?.kind ?? null, optional: r.optional === true };
      recipes.set(r.recipe_id, [...(recipes.get(r.recipe_id) ?? []), line]);
    }
    return { sold, recipes };
  } catch (e) {
    if (!schemaMissing(e as { code?: string })) console.warn("bar usage: Bar Book drinks not read", e);
    return none;
  }
}

// Custom drinks ("What's in it?") sold since `since`, with the ingredient
// list on each line (order_items.custom_recipe, migration 20261005010000).
// Empty before that migration, or if it can't be read.
async function customDrinkLines(since: Date): Promise<{ quantity: number; custom_recipe: unknown; modifiers: string[] | null }[]> {
  const supabase = createAdminClient();
  try {
    return await fetchAll<{ quantity: number; custom_recipe: unknown; modifiers: string[] | null }>((from, to) =>
      supabase
        .from("order_items")
        .select("quantity, custom_recipe, modifiers, orders!inner(status, completed_at)")
        .eq("orders.status", "completed")
        .gte("orders.completed_at", since.toISOString())
        .not("custom_recipe", "is", null)
        .order("id")
        .range(from, to),
    );
  } catch (e) {
    if (!schemaMissing(e as { code?: string })) console.warn("bar usage: custom drinks not read", e);
    return [];
  }
}

export interface BookDrinkSale {
  recipeId: string;
  name: string;
  sold: number;
  revenue: number;
}

// Reports → Bar usage: the Bar Book drinks rung up off the menu in the
// last `days` business days, by drink. They're Alcohol sales everywhere
// else (the Day report counts them with the bar); this names them.
export async function getBookDrinkSales(days: number): Promise<BookDrinkSale[]> {
  const dates = recentBusinessDays(days);
  const since = new Date(businessDayWindow(dates[dates.length - 1]).start);
  const { sold } = await bookDrinkLines(since);
  const by = new Map<string, BookDrinkSale>();
  for (const l of sold) {
    const row = by.get(l.recipe_id) ?? { recipeId: l.recipe_id, name: l.name, sold: 0, revenue: 0 };
    row.sold += l.quantity;
    row.revenue = round2(row.revenue + Number(l.unit_price) * l.quantity);
    by.set(l.recipe_id, row);
  }
  return [...by.values()].sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name));
}

export interface PourCostRow {
  menuItemId: string;
  name: string;
  price: number;
  ingredientCost: number | null;
  pourCostPct: number | null;
}

// Ingredient cost as a % of menu price, per alcohol drink -- the standard
// bar-industry "pour cost" metric (target is usually ~16-20%). Only
// computed for items whose recipe has every ingredient costed; a partially
// costed recipe would understate cost and overstate margin, which is worse
// than just not showing a number.
export async function getPourCostReport(): Promise<PourCostRow[]> {
  const supabase = createAdminClient();
  const [{ data: items, error: itemErr }, { data: ingredients, error: ingErr }, recipesByItem] = await Promise.all([
    supabase.from("menu_items").select("id, name, price").eq("is_alcohol", true).eq("active", true),
    supabase.from("ingredients").select("id, unit_cost"),
    getRecipesByItem(),
  ]);
  if (itemErr) throw itemErr;
  if (ingErr) throw ingErr;

  const costByIngredient = new Map((ingredients ?? []).map((i) => [i.id, i.unit_cost !== null ? Number(i.unit_cost) : null]));

  const rows: PourCostRow[] = (items ?? [])
    .map((item) => {
      const recipe = recipesByItem[item.id];
      if (!recipe || recipe.ingredients.length === 0) return { menuItemId: item.id, name: item.name, price: Number(item.price), ingredientCost: null, pourCostPct: null };

      let cost = 0;
      for (const ri of recipe.ingredients) {
        const unitCost = costByIngredient.get(ri.ingredient_id);
        if (unitCost === null || unitCost === undefined) {
          cost = NaN; // one uncosted ingredient makes the whole recipe's cost unknown
          break;
        }
        cost += ri.quantity * unitCost;
      }
      const ingredientCost = isNaN(cost) ? null : cost;
      const price = Number(item.price);
      return {
        menuItemId: item.id,
        name: item.name,
        price,
        ingredientCost,
        pourCostPct: ingredientCost !== null && price > 0 ? ingredientCost / price : null,
      };
    })
    .sort((a, b) => (b.pourCostPct ?? -1) - (a.pourCostPct ?? -1));

  return rows;
}

export interface DashboardSummary {
  todaysRevenue: number;
  todaysOrders: number;
  todaysOwnerTabOrders: number; // put on an owner's tab: no money in, so not in the two above
  totalMembers: number;
  compedMembers: number;
  upcomingScreenings: number;
}

// Quick "site details" snapshot shown at the top of /admin.
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = createAdminClient();
  const { start } = businessDayWindow(businessDay().date);

  const [todaysOrdersRes, memberCountRes, compedCountRes, screeningsCountRes] = await Promise.all([
    supabase.from("orders").select("total, payment_method").eq("status", "completed").gte("completed_at", start),
    supabase.from("members").select("id", { count: "exact", head: true }).is("erased_at", null),
    supabase.from("members").select("id", { count: "exact", head: true }).is("erased_at", null).eq("comped", true),
    supabase.from("screenings").select("id", { count: "exact", head: true }).gte("starts_at", new Date().toISOString()),
  ]);
  if (todaysOrdersRes.error) throw todaysOrdersRes.error;
  if (memberCountRes.error) throw memberCountRes.error;
  if (compedCountRes.error) throw compedCountRes.error;
  if (screeningsCountRes.error) throw screeningsCountRes.error;

  // Owner-tab orders took no money: counted on their own.
  const all = todaysOrdersRes.data ?? [];
  const todaysOrders = all.filter((o) => !isOwnerTab(o));
  return {
    todaysRevenue: todaysOrders.reduce((s, o) => s + o.total, 0),
    todaysOrders: todaysOrders.length,
    todaysOwnerTabOrders: all.length - todaysOrders.length,
    totalMembers: memberCountRes.count ?? 0,
    compedMembers: compedCountRes.count ?? 0,
    upcomingScreenings: screeningsCountRes.count ?? 0,
  };
}

// ---------- order search ----------

// One order by its number, with the business day it belongs to (for "see
// that day"). Null when there's no such order, or it was never finished
// (open tabs and held orders aren't in Reports).
export async function getOrderByNumber(orderNumber: number, viewer?: { role?: string | null } | null): Promise<DayOrder | null> {
  if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("orders").select(DAY_ORDER_COLUMNS).eq("order_number", orderNumber).in("status", ["completed", "refunded", "voided"]).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as DayOrderRow;
  const { start, end } = businessDayWindow(businessDay(new Date(row.completed_at)).date);
  const [partials, buckets, names] = await Promise.all([
    row.status === "completed" ? getPartialRefunds(start, end) : [],
    loadBuckets(),
    firstNames(isOwnerTab(row) && mayViewOwnerTab(viewer) ? [row.owner_tab_employee_id] : []),
  ]);
  const order = toDayOrder(row, partsByOrder(partials.filter((p) => p.order_id === row.id)).get(row.id) ?? NOTHING_REFUNDED, buckets, names);
  return mayViewOwnerTab(viewer) ? order : redactOwnerOrder(order);
}

// ---------- sales tax ----------
// Sales tax collected, by month, for the Missouri return. Business days
// (4 a.m. Central), so a sale after midnight on the last night of a month
// counts in that month, the same as everywhere else in Reports.
//
// Counted: completed register and web orders (their tax; register tickets'
// tax is on their order), online ticket bookings (the tax Stripe added),
// booth bookings (tax_amount), Insiders+ memberships (every card charge
// Stripe made: new, renewals, switches to yearly) and gift memberships,
// both from member_payments. Refunds: a fully refunded order, booking or
// cancelled booth isn't counted at all; a partial refund, and a membership
// refund, comes off in the month of the sale. So a refund made after a
// month was filed changes that month here.

export interface TaxLine {
  label: string;
  sales: number; // before tax, after discounts, tips left out
  tax: number;
}

export interface TaxMonth {
  month: string; // "2026-09", or the period for the total
  label: string; // "September 2026"
  lines: TaxLine[];
  refunds: TaxLine; // partial refunds, taken off
  exemptSales: number; // register orders rung up tax-free (inside the lines' sales)
  sales: number; // net: all lines less refunds
  tax: number; // net tax collected
}

export interface SalesTaxReport {
  period: string; // "2026-09" or "2026-Q3"
  label: string;
  months: TaxMonth[];
  total: TaxMonth;
  ratePercent: number;
  giftsTracked: boolean; // false until the gift memberships migration is applied
  membershipsTracked: boolean; // false until the member payments migration is applied
  // Membership charges in the period that carried no tax on top
  // (subscriptions started before tax was added keep renewing without it):
  // how many, what was charged, and the tax counted inside it (0 unless
  // UNTAXED_MEMBERSHIPS in lib/sales-tax.ts is "included").
  untaxedMemberships: { count: number; charged: number; taxInside: number };
  // Register orders rung up tax-free in the period: when, how much, the tax
  // not charged, who marked it and why.
  taxFreeOrders: TaxFreeOrder[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// "2026-09" or "2026-Q3" to the months it covers. Null when it's neither.
export function taxPeriodMonths(period: string): string[] | null {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return [period];
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!quarter) return null;
  const first = (Number(quarter[2]) - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${quarter[1]}-${String(first + i).padStart(2, "0")}`);
}

export function taxPeriodLabel(period: string): string {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!quarter) return monthLabel(period);
  const months = taxPeriodMonths(period)!;
  const short = (m: string) => MONTHS[Number(m.slice(5)) - 1].slice(0, 3);
  return `Q${quarter[2]} ${quarter[1]} (${short(months[0])}–${short(months[2])})`;
}

function emptyMonth(month: string, label: string): TaxMonth {
  return { month, label, lines: [], refunds: { label: "Partial refunds", sales: 0, tax: 0 }, exemptSales: 0, sales: 0, tax: 0 };
}

// Owner-tab sales (lib/register-totals.ts) are counted in the month they're
// rung, at the owner rate, with the tax charged on them, whether or not the
// owner has paid the tab yet, the same as a sale on account. (Andrew to
// confirm that treatment with the accountant.)
const TAX_SOURCES = {
  register: "Register sales (food, drinks, register tickets)",
  owner: "Owner tab (at cost, paid monthly)",
  web: "Website orders",
  tickets: "Online ticket sales",
  booths: "Booth bookings",
  memberships: "Insiders+ memberships",
  gifts: "Gift memberships",
} as const;
type TaxSource = keyof typeof TAX_SOURCES;

export async function getSalesTaxReport(period: string): Promise<SalesTaxReport | null> {
  const months = taxPeriodMonths(period);
  if (!months) return null;
  const supabase = createAdminClient();
  const start = businessDayWindow(`${months[0]}-01`).start;
  const end = businessDayWindow(`${nextMonth(months[months.length - 1])}-01`).start;

  type OrderRow = TaxFreeOrderRow & { source: string; tax: number; payment_method: string | null };
  type BookingRow = { quantity: number; unit_price: number; tax_amount: number; created_at: string };
  type BoothRow = { fee_amount: number; tax_amount: number | null; created_at: string };
  type GiftRow = { price: number; tax_amount: number; paid_at: string };

  let giftsTracked = true;
  const [orders, bookings, booths, memberships, partials] = await Promise.all([
    fetchAll<OrderRow>((from, to) =>
      // "*" for the tax-exempt columns, once their migration is in.
      supabase
        .from("orders")
        .select("*, employee:employees!orders_employee_id_fkey(name)")
        .eq("status", "completed")
        .gte("completed_at", start)
        .lt("completed_at", end)
        .order("id")
        .range(from, to),
    ),
    // Register tickets (order_id set) are taxed on their order, counted above.
    fetchAll<BookingRow>((from, to) =>
      supabase.from("bookings").select("quantity, unit_price, tax_amount, created_at").eq("status", "confirmed").is("order_id", null).gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    fetchAll<BoothRow>((from, to) =>
      supabase.from("booth_reservations").select("fee_amount, tax_amount, created_at").eq("status", "confirmed").gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    // Insiders+ charges and gift memberships, with their refunds (negative).
    getMemberPaymentsBetween(start, end),
    getPartialRefunds(start, end),
  ]);
  // Until the member payments migration is applied, gifts are read where
  // they were before (and Insiders+ isn't counted: the screen says so).
  const gifts = memberships.tracked
    ? []
    : await fetchAll<GiftRow>((from, to) =>
        supabase.from("gift_memberships").select("price, tax_amount, paid_at").eq("status", "paid").gte("paid_at", start).lt("paid_at", end).order("id").range(from, to),
      ).catch(() => {
        giftsTracked = false;
        return [] as GiftRow[];
      });

  await attachTaxExemptNames(orders);

  const byMonth = new Map(months.map((m) => [m, { lines: new Map<TaxSource, TaxLine>(), refunds: { sales: 0, tax: 0 }, exempt: 0 }]));
  const monthOf = (iso: string) => byMonth.get(businessDay(new Date(iso)).date.slice(0, 7));
  const add = (iso: string, source: TaxSource, sales: number, tax: number) => {
    const m = monthOf(iso);
    if (!m) return;
    const line = m.lines.get(source) ?? { label: TAX_SOURCES[source], sales: 0, tax: 0 };
    line.sales += sales;
    line.tax += tax;
    m.lines.set(source, line);
  };

  for (const o of orders) {
    // Gift cards sold aren't a sale for the tax return (they're taxed when
    // spent), so they're left out (gift_card_sales, 20261009120000).
    const giftCards = Number((o as { gift_card_sales?: number | null }).gift_card_sales ?? 0);
    const sales = Number(o.total) - Number(o.tax) - Number(o.tip) - giftCards;
    add(o.completed_at, isOwnerTab(o) ? "owner" : o.source === "pos" ? "register" : "web", sales, Number(o.tax));
    const m = o.tax_free ? monthOf(o.completed_at) : undefined;
    if (m) m.exempt += sales;
  }
  // Paid seats only: an Insiders+ free seat on the same booking wasn't charged (bookingSeats).
  for (const b of bookings) add(b.created_at, "tickets", bookingSeats(b).paid * Number(b.unit_price), Number(b.tax_amount));
  for (const r of booths) add(r.created_at, "booths", Number(r.fee_amount), Number(r.tax_amount ?? 0));
  for (const g of gifts) add(g.paid_at, "gifts", Number(g.price), Number(g.tax_amount));
  // A membership on its business day; a refund of one on its payment's day.
  const untaxedMemberships = { count: 0, charged: 0, taxInside: 0 };
  for (const r of memberships.rows) {
    if (r.kind !== "refund" && (r.tax_inside || r.tax_cents === 0) && r.amount_cents > 0) {
      untaxedMemberships.count++;
      untaxedMemberships.charged = round2(untaxedMemberships.charged + r.amount_cents / 100);
      if (r.tax_inside) untaxedMemberships.taxInside = round2(untaxedMemberships.taxInside + r.tax_cents / 100);
    }
    const m = byMonth.get(r.business_date.slice(0, 7));
    if (!m) continue;
    const source: TaxSource = r.product === "gift" ? "gifts" : "memberships";
    const line = m.lines.get(source) ?? { label: TAX_SOURCES[source], sales: 0, tax: 0 };
    line.sales += r.sales_cents / 100;
    line.tax += r.tax_cents / 100;
    m.lines.set(source, line);
  }
  for (const p of partials) {
    const m = monthOf(p.orders.completed_at);
    if (!m) continue;
    m.refunds.sales += Number(p.amount) - Number(p.tax_amount);
    m.refunds.tax += Number(p.tax_amount);
  }

  const sourceOrder = Object.keys(TAX_SOURCES) as TaxSource[];
  const result: TaxMonth[] = months.map((month) => {
    const m = byMonth.get(month)!;
    const lines = sourceOrder
      .map((s) => m.lines.get(s))
      // A line with nothing on it (only free tickets, say) is left off.
      .filter((l): l is TaxLine => !!l && (Math.abs(l.sales) >= 0.005 || Math.abs(l.tax) >= 0.005))
      .map((l) => ({ ...l, sales: round2(l.sales), tax: round2(l.tax) }));
    const refunds = { label: "Partial refunds", sales: round2(m.refunds.sales), tax: round2(m.refunds.tax) };
    return {
      month,
      label: monthLabel(month),
      lines,
      refunds,
      exemptSales: round2(m.exempt),
      sales: round2(lines.reduce((s, l) => s + l.sales, 0) - refunds.sales),
      tax: round2(lines.reduce((s, l) => s + l.tax, 0) - refunds.tax),
    };
  });

  // The period as a whole: the same lines, added up across its months.
  const total = emptyMonth(period, taxPeriodLabel(period));
  const totalLines = new Map<string, TaxLine>();
  for (const m of result) {
    for (const l of m.lines) {
      const t = totalLines.get(l.label) ?? { label: l.label, sales: 0, tax: 0 };
      t.sales = round2(t.sales + l.sales);
      t.tax = round2(t.tax + l.tax);
      totalLines.set(l.label, t);
    }
    total.refunds.sales = round2(total.refunds.sales + m.refunds.sales);
    total.refunds.tax = round2(total.refunds.tax + m.refunds.tax);
    total.exemptSales = round2(total.exemptSales + m.exemptSales);
    total.sales = round2(total.sales + m.sales);
    total.tax = round2(total.tax + m.tax);
  }
  total.lines = sourceOrder.map((s) => totalLines.get(TAX_SOURCES[s])).filter((l): l is TaxLine => !!l);

  return { period, label: taxPeriodLabel(period), months: result, total, ratePercent: SALES_TAX_PERCENT, giftsTracked, membershipsTracked: memberships.tracked, untaxedMemberships, taxFreeOrders: taxFreeOrders(orders) };
}

// What the tax on a period's taxable sales comes to at the Joplin rate, to
// compare with what was collected. They differ by rounding, and by sales
// that didn't carry tax (online tickets before 9/28, tax-free orders).
export function expectedTax(m: TaxMonth): number {
  return round2((m.sales - m.exemptSales) * SALES_TAX_RATE);
}
