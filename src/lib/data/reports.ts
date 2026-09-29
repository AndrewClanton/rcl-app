import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRecipesByItem } from "./recipes";
import { businessDay, businessDayWindow, centralDate, recentBusinessDays } from "@/lib/ops/time";
import { SALES_TAX_PERCENT, SALES_TAX_RATE } from "@/lib/sales-tax";
import { mostRefundable } from "./refund-plan";

// Every report here works in business days: 4 a.m. to 4 a.m. Central, the
// same day the register and shifts use, so a late sale counts tonight.

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
}

export interface DayReport {
  date: string;
  orders: DayOrder[];
  // Money in, by how it arrived: the register's cash and card, and the
  // website (online tickets, booth fees, web orders). Includes tax and tips.
  // Vouchers (trivia prizes) paid for goods but brought in no money, so
  // they're counted apart from what was collected. Partial refunds on the
  // day's orders are already taken off.
  vouchers: number;
  cash: number;
  card: number;
  online: number;
  tips: number;
  tax: number;
  collected: number;
  // What was sold, before tax and tips.
  sold: { label: string; amount: number; detail?: string }[];
  discounts: number;
  partialRefunds: number; // goods given back on part-refunded orders, before tax
  netSales: number;
  ticketsSold: number;
  topItems: { name: string; qty: number; revenue: number; options: string }[];
  // Nathan's split for moving the day's money into the right accounts.
  accounts: { label: string; rule: string; amount: number }[];
  unassigned: number;
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

type DayOrderRow = {
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
  tax: number;
  tip: number;
  total: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  stripe_payment_intent_id: string | null;
  employee: { name: string } | null;
  items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; menu_item_id: string | null; is_alcohol: boolean; screening_id: string | null }[];
};

// The cashier join names its foreign key: since the manager-PIN migration,
// orders has two links to employees (who rang it up, and refund_approved_by),
// and a bare employees(name) fails with "more than one relationship".
const DAY_ORDER_COLUMNS =
  "id, order_number, status, source, completed_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, tax, tip, total, tier_discount, monthly_discount, redemption_discount, stripe_payment_intent_id, employee:employees!orders_employee_id_fkey(name), items:order_items(name, quantity, unit_price, modifiers, menu_item_id, is_alcohol, screening_id)";

// One order as the Orders table shows it. `refunded` is what partial
// refunds have given back so far.
function toDayOrder(o: DayOrderRow, refunded: number): DayOrder {
  return {
    id: o.id,
    orderNumber: Number(o.order_number),
    status: o.status,
    at: o.completed_at,
    cashier: o.employee?.name ?? null,
    name: o.tab_name || o.order_name || null,
    items: o.items.map((l) => (l.quantity > 1 ? `${l.quantity} ${l.name}` : l.name)).join(", "),
    // "cash + voucher" when vouchers paid part of it.
    method: Number(o.payment_voucher_amount) > 0 && o.payment_method !== "voucher" ? `${o.payment_method} + voucher` : o.payment_method,
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
  };
}

export async function getDayReport(date: string): Promise<DayReport> {
  const supabase = createAdminClient();
  const { start, end } = businessDayWindow(date);

  const [orders, bookings, booths, menuRes, catRes, partials] = await Promise.all([
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
    fetchAll<{ quantity: number; unit_price: number; tax_amount: number; order_id: string | null }>((from, to) =>
      supabase.from("bookings").select("quantity, unit_price, tax_amount, order_id").eq("status", "confirmed").gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    fetchAll<{ fee_amount: number; tax_amount: number | null }>((from, to) =>
      supabase.from("booth_reservations").select("fee_amount, tax_amount").eq("status", "confirmed").gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    supabase.from("menu_items").select("id, category_id"),
    supabase.from("menu_categories").select("id, key"),
    getPartialRefunds(start, end),
  ]);
  for (const r of [menuRes, catRes]) if (r.error) throw r.error;

  const completed = orders.filter((o) => o.status === "completed");
  const boothRevenue = booths.reduce((s, r) => s + Number(r.fee_amount), 0);
  // Booth bookings carry the sales tax Stripe added (since 9/29), which was collected with the fee.
  const boothTax = booths.reduce((s, r) => s + Number(r.tax_amount ?? 0), 0);
  const refundedByOrder = new Map<string, number>();
  for (const p of partials) refundedByOrder.set(p.order_id, round2((refundedByOrder.get(p.order_id) ?? 0) + Number(p.amount)));

  const categoryKeyById = new Map((catRes.data ?? []).map((c) => [c.id, c.key]));
  const bucketByItem = new Map((menuRes.data ?? []).map((m) => [m.id, CATEGORY_BUCKET[categoryKeyById.get(m.category_id) ?? ""]]));

  let vouchers = 0,
    cash = 0,
    card = 0,
    online = 0,
    tips = 0,
    tax = 0,
    discounts = 0;
  const category = { food: 0, coffee: 0, soda: 0, liquor: 0, other: 0 };
  const items = new Map<string, { qty: number; revenue: number; options: Map<string, number> }>();
  for (const o of completed) {
    if (o.source === "pos") {
      cash += Number(o.payment_cash_amount ?? 0);
      card += Number(o.payment_card_amount ?? 0);
      vouchers += Number(o.payment_voucher_amount ?? 0);
    } else online += Number(o.total);
    tips += Number(o.tip);
    tax += Number(o.tax);
    discounts += Number(o.tier_discount) + Number(o.monthly_discount) + Number(o.redemption_discount);
    for (const l of o.items) {
      const amount = Number(l.unit_price) * l.quantity;
      // Tickets are counted from their bookings below, not as bar sales.
      if (!l.screening_id) category[l.is_alcohol ? "liquor" : ((l.menu_item_id && bucketByItem.get(l.menu_item_id)) || "other")] += amount;
      const it = items.get(l.name) ?? { qty: 0, revenue: 0, options: new Map() };
      it.qty += l.quantity;
      it.revenue += amount;
      for (const m of l.modifiers ?? []) it.options.set(m, (it.options.get(m) ?? 0) + l.quantity);
      items.set(l.name, it);
    }
  }

  const ticketsSold = bookings.reduce((s, b) => s + b.quantity, 0);
  const paidTickets = bookings.filter((b) => Number(b.unit_price) > 0).reduce((s, b) => s + b.quantity, 0);
  const ticketRevenue = bookings.reduce((s, b) => s + b.quantity * Number(b.unit_price), 0);
  // Online tickets: price plus the sales tax Stripe added (register tickets'
  // tax is already in their order).
  const onlineTicketTax = bookings.filter((b) => !b.order_id).reduce((s, b) => s + Number(b.tax_amount), 0);
  online += bookings.filter((b) => !b.order_id).reduce((s, b) => s + b.quantity * Number(b.unit_price), 0) + onlineTicketTax + boothRevenue + boothTax;
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

  const sold = [
    { label: "Movie tickets", amount: ticketRevenue, detail: ticketsSold ? `${ticketsSold} sold${ticketsSold > paidTickets ? `, ${ticketsSold - paidTickets} free` : ""}` : undefined },
    { label: "Food", amount: category.food },
    { label: "Candy & other", amount: category.other },
    { label: "Drinks", amount: category.soda },
    { label: "Coffee", amount: category.coffee },
    { label: "Alcohol", amount: category.liquor },
    { label: "Booths", amount: boothRevenue },
  ].filter((r) => r.amount > 0 || r.detail);
  const grossSales = sold.reduce((s, r) => s + r.amount, 0);
  const foodAndDrink = category.food + category.coffee + category.soda + category.liquor;

  return {
    date,
    orders: orders.map((o) => toDayOrder(o, refundedByOrder.get(o.id) ?? 0)),
    vouchers,
    cash,
    card,
    online,
    tips,
    tax,
    collected: cash + card + online,
    sold,
    discounts,
    partialRefunds,
    netSales: grossSales - discounts - partialRefunds,
    ticketsSold,
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
      { label: "Box office", rule: `$4 × ${paidTickets} paid ticket${paidTickets === 1 ? "" : "s"}`, amount: paidTickets * BOX_OFFICE_PER_TICKET },
      { label: "Inventory", rule: `20% of ${money(foodAndDrink)} food & drink`, amount: foodAndDrink * INVENTORY_SHARE },
      { label: "Expenses", rule: `80% of ${money(foodAndDrink)} food & drink`, amount: foodAndDrink * EXPENSE_SHARE },
    ],
    // Sales none of the rules above claims: ticket and booth money past the
    // $4 carve-out, and candy/other.
    unassigned: ticketRevenue - paidTickets * BOX_OFFICE_PER_TICKET + boothRevenue + category.other,
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
  total: number;
}

// Money in per business day (register + website), oldest first, with empty
// days included so the chart's days line up.
export async function getRevenueTrend(days: number): Promise<RevenueDay[]> {
  const supabase = createAdminClient();
  const dates = recentBusinessDays(days).reverse();
  const { start } = businessDayWindow(dates[0]);

  // Paged: 90 days of orders is well past the database's 1,000-row answer.
  const [orders, bookings, booths, partials] = await Promise.all([
    fetchAll<{ total: number; source: string; completed_at: string }>((from, to) =>
      supabase.from("orders").select("total, source, completed_at").eq("status", "completed").gte("completed_at", start).order("id").range(from, to),
    ),
    // Register tickets are already inside their order's total.
    fetchAll<{ quantity: number; unit_price: number; tax_amount: number; created_at: string }>((from, to) =>
      supabase.from("bookings").select("quantity, unit_price, tax_amount, created_at").eq("status", "confirmed").is("order_id", null).gte("created_at", start).order("id").range(from, to),
    ),
    fetchAll<{ fee_amount: number; tax_amount: number | null; created_at: string }>((from, to) =>
      supabase.from("booth_reservations").select("fee_amount, tax_amount, created_at").eq("status", "confirmed").gte("created_at", start).order("id").range(from, to),
    ),
    getPartialRefunds(start, null),
  ]);

  const byDay = new Map(dates.map((d) => [d, { register: 0, online: 0 }]));
  const add = (iso: string, key: "register" | "online", amount: number) => {
    const entry = byDay.get(businessDay(new Date(iso)).date);
    if (entry) entry[key] += amount;
  };
  for (const o of orders) add(o.completed_at, o.source === "pos" ? "register" : "online", Number(o.total));
  for (const b of bookings) add(b.created_at, "online", b.quantity * Number(b.unit_price) + Number(b.tax_amount));
  for (const r of booths) add(r.created_at, "online", Number(r.fee_amount) + Number(r.tax_amount ?? 0));
  // A partial refund comes off the day of the sale, like the Day view.
  for (const p of partials) add(p.orders.completed_at, p.orders.source === "pos" ? "register" : "online", -Number(p.amount));

  return [...byDay.entries()].map(([date, v]) => ({ date, ...v, total: v.register + v.online }));
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
    created_at: string;
    community_program: { name: string } | null;
  };
  // Paged: the database returns at most 1,000 rows per request, and there
  // are more members than that since the old-site import.
  const members: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("members")
      .select("tier, comped, stripe_subscription_id, created_at, community_program:community_programs(name)")
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
      if (m.stripe_subscription_id) payingInsidersPlus++;
    } else {
      insiders++;
    }
    if (m.comped) {
      compedMembers++;
      const program = m.community_program?.name ?? "Unspecified program";
      programTally.set(program, (programTally.get(program) ?? 0) + 1);
    }
    if (new Date(m.created_at) >= startOfMonth) newThisMonth++;
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
  const [{ data: ingredients, error: ingErr }, orderItems, counts, recipesByItem] = await Promise.all([
    supabase.from("ingredients").select("id, name, unit, unit_cost").eq("active", true).order("category").order("name"),
    fetchAll<{ menu_item_id: string | null; quantity: number }>((from, to) =>
      supabase
        .from("order_items")
        .select("menu_item_id, quantity, orders!inner(status, completed_at)")
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
  ]);
  if (ingErr) throw ingErr;

  const theoreticalByIngredient = new Map<string, number>();
  for (const oi of orderItems) {
    const recipe = oi.menu_item_id ? recipesByItem[oi.menu_item_id] : undefined;
    if (!recipe) continue;
    for (const ri of recipe.ingredients) {
      theoreticalByIngredient.set(ri.ingredient_id, (theoreticalByIngredient.get(ri.ingredient_id) ?? 0) + ri.quantity * oi.quantity);
    }
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

  const rows: AlcoholUsageRow[] = (ingredients ?? []).map((ing) => {
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
  totalMembers: number;
  compedMembers: number;
  upcomingScreenings: number;
}

// Quick "site details" snapshot shown at the top of /admin.
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = createAdminClient();
  const { start } = businessDayWindow(businessDay().date);

  const [todaysOrdersRes, memberCountRes, compedCountRes, screeningsCountRes] = await Promise.all([
    supabase.from("orders").select("total").eq("status", "completed").gte("completed_at", start),
    supabase.from("members").select("id", { count: "exact", head: true }).is("erased_at", null),
    supabase.from("members").select("id", { count: "exact", head: true }).is("erased_at", null).eq("comped", true),
    supabase.from("screenings").select("id", { count: "exact", head: true }).gte("starts_at", new Date().toISOString()),
  ]);
  if (todaysOrdersRes.error) throw todaysOrdersRes.error;
  if (memberCountRes.error) throw memberCountRes.error;
  if (compedCountRes.error) throw compedCountRes.error;
  if (screeningsCountRes.error) throw screeningsCountRes.error;

  const todaysOrders = todaysOrdersRes.data ?? [];
  return {
    todaysRevenue: todaysOrders.reduce((s, o) => s + o.total, 0),
    todaysOrders: todaysOrders.length,
    totalMembers: memberCountRes.count ?? 0,
    compedMembers: compedCountRes.count ?? 0,
    upcomingScreenings: screeningsCountRes.count ?? 0,
  };
}

// ---------- order search ----------

// One order by its number, with the business day it belongs to (for "see
// that day"). Null when there's no such order, or it was never finished
// (open tabs and held orders aren't in Reports).
export async function getOrderByNumber(orderNumber: number): Promise<DayOrder | null> {
  if (!Number.isSafeInteger(orderNumber) || orderNumber <= 0) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("orders").select(DAY_ORDER_COLUMNS).eq("order_number", orderNumber).in("status", ["completed", "refunded", "voided"]).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as DayOrderRow;
  const { start, end } = businessDayWindow(businessDay(new Date(row.completed_at)).date);
  const partials = row.status === "completed" ? await getPartialRefunds(start, end) : [];
  const refunded = partials.filter((p) => p.order_id === row.id).reduce((s, p) => s + Number(p.amount), 0);
  return toDayOrder(row, round2(refunded));
}

// ---------- sales tax ----------
// Sales tax collected, by month, for the Missouri return. Business days
// (4 a.m. Central), so a sale after midnight on the last night of a month
// counts in that month, the same as everywhere else in Reports.
//
// Counted: completed register and web orders (their tax; register tickets'
// tax is on their order), online ticket bookings (the tax Stripe added),
// booth bookings (tax_amount), and gift memberships. Refunds: a fully
// refunded order, booking or cancelled booth isn't counted at all; a
// partial refund comes off, in the month of the sale. So a refund made
// after a month was filed changes that month here.
//
// Not here: Insiders+ monthly and yearly memberships. Stripe bills and
// taxes those directly; their tax is in Stripe's own tax report.

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

const TAX_SOURCES = {
  register: "Register sales (food, drinks, register tickets)",
  web: "Website orders",
  tickets: "Online ticket sales",
  booths: "Booth bookings",
  gifts: "Gift memberships",
} as const;
type TaxSource = keyof typeof TAX_SOURCES;

export async function getSalesTaxReport(period: string): Promise<SalesTaxReport | null> {
  const months = taxPeriodMonths(period);
  if (!months) return null;
  const supabase = createAdminClient();
  const start = businessDayWindow(`${months[0]}-01`).start;
  const end = businessDayWindow(`${nextMonth(months[months.length - 1])}-01`).start;

  type OrderRow = { source: string; tax_free: boolean; tax: number; tip: number; total: number; completed_at: string };
  type BookingRow = { quantity: number; unit_price: number; tax_amount: number; created_at: string };
  type BoothRow = { fee_amount: number; tax_amount: number | null; created_at: string };
  type GiftRow = { price: number; tax_amount: number; paid_at: string };

  let giftsTracked = true;
  const [orders, bookings, booths, gifts, partials] = await Promise.all([
    fetchAll<OrderRow>((from, to) =>
      supabase.from("orders").select("source, tax_free, tax, tip, total, completed_at").eq("status", "completed").gte("completed_at", start).lt("completed_at", end).order("id").range(from, to),
    ),
    // Register tickets (order_id set) are taxed on their order, counted above.
    fetchAll<BookingRow>((from, to) =>
      supabase.from("bookings").select("quantity, unit_price, tax_amount, created_at").eq("status", "confirmed").is("order_id", null).gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    fetchAll<BoothRow>((from, to) =>
      supabase.from("booth_reservations").select("fee_amount, tax_amount, created_at").eq("status", "confirmed").gte("created_at", start).lt("created_at", end).order("id").range(from, to),
    ),
    fetchAll<GiftRow>((from, to) =>
      supabase.from("gift_memberships").select("price, tax_amount, paid_at").eq("status", "paid").gte("paid_at", start).lt("paid_at", end).order("id").range(from, to),
    ).catch(() => {
      giftsTracked = false;
      return [] as GiftRow[];
    }),
    getPartialRefunds(start, end),
  ]);

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
    const sales = Number(o.total) - Number(o.tax) - Number(o.tip);
    add(o.completed_at, o.source === "pos" ? "register" : "web", sales, Number(o.tax));
    const m = o.tax_free ? monthOf(o.completed_at) : undefined;
    if (m) m.exempt += sales;
  }
  for (const b of bookings) add(b.created_at, "tickets", b.quantity * Number(b.unit_price), Number(b.tax_amount));
  for (const r of booths) add(r.created_at, "booths", Number(r.fee_amount), Number(r.tax_amount ?? 0));
  for (const g of gifts) add(g.paid_at, "gifts", Number(g.price), Number(g.tax_amount));
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

  return { period, label: taxPeriodLabel(period), months: result, total, ratePercent: SALES_TAX_PERCENT, giftsTracked };
}

// What the tax on a period's taxable sales comes to at the Joplin rate, to
// compare with what was collected. They differ by rounding, and by sales
// that didn't carry tax (online tickets before 9/28, tax-free orders).
export function expectedTax(m: TaxMonth): number {
  return round2((m.sales - m.exemptSales) * SALES_TAX_RATE);
}
