import { createAdminClient } from "@/lib/supabase/admin";
import { getRecipesByItem } from "./recipes";
import { businessDay, businessDayWindow, recentBusinessDays } from "@/lib/ops/time";

// Every report here works in business days: 4 a.m. to 4 a.m. Central, the
// same day the register and shifts use, so a late sale counts tonight.

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
}

export interface DayReport {
  date: string;
  orders: DayOrder[];
  // Money in, by how it arrived: the register's cash and card, and the
  // website (online tickets, booth fees, web orders). Includes tax and tips.
  // Vouchers (trivia prizes) paid for goods but brought in no money, so
  // they're counted apart from what was collected.
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
  employee: { name: string } | null;
  items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; menu_item_id: string | null; is_alcohol: boolean; screening_id: string | null }[];
};

export async function getDayReport(date: string): Promise<DayReport> {
  const supabase = createAdminClient();
  const { start, end } = businessDayWindow(date);

  const [ordersRes, bookingsRes, boothsRes, menuRes, catRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_number, status, source, completed_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, tax, tip, total, tier_discount, monthly_discount, redemption_discount, employee:employees!orders_employee_id_fkey(name), items:order_items(name, quantity, unit_price, modifiers, menu_item_id, is_alcohol, screening_id)",
      )
      .in("status", ["completed", "refunded", "voided"])
      .gte("completed_at", start)
      .lt("completed_at", end)
      .order("completed_at", { ascending: false }),
    // Every ticket, online or at the register, has a booking.
    supabase.from("bookings").select("quantity, unit_price, tax_amount, order_id").eq("status", "confirmed").gte("created_at", start).lt("created_at", end),
    supabase.from("booth_reservations").select("fee_amount").eq("status", "confirmed").gte("created_at", start).lt("created_at", end),
    supabase.from("menu_items").select("id, category_id"),
    supabase.from("menu_categories").select("id, key"),
  ]);
  for (const r of [ordersRes, bookingsRes, boothsRes, menuRes, catRes]) if (r.error) throw r.error;

  const orders = (ordersRes.data ?? []) as unknown as DayOrderRow[];
  const completed = orders.filter((o) => o.status === "completed");
  const bookings = bookingsRes.data ?? [];
  const boothRevenue = (boothsRes.data ?? []).reduce((s, r) => s + Number(r.fee_amount), 0);

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
  online += bookings.filter((b) => !b.order_id).reduce((s, b) => s + b.quantity * Number(b.unit_price), 0) + onlineTicketTax + boothRevenue;
  tax += onlineTicketTax;

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
    orders: orders.map((o) => ({
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
    })),
    vouchers,
    cash,
    card,
    online,
    tips,
    tax,
    collected: cash + card + online,
    sold,
    discounts,
    netSales: grossSales - discounts,
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

  const [ordersRes, bookingsRes, boothsRes] = await Promise.all([
    supabase.from("orders").select("total, source, completed_at").eq("status", "completed").gte("completed_at", start),
    // Register tickets are already inside their order's total.
    supabase.from("bookings").select("quantity, unit_price, tax_amount, created_at").eq("status", "confirmed").is("order_id", null).gte("created_at", start),
    supabase.from("booth_reservations").select("fee_amount, created_at").eq("status", "confirmed").gte("created_at", start),
  ]);
  for (const r of [ordersRes, bookingsRes, boothsRes]) if (r.error) throw r.error;

  const byDay = new Map(dates.map((d) => [d, { register: 0, online: 0 }]));
  const add = (iso: string, key: "register" | "online", amount: number) => {
    const entry = byDay.get(businessDay(new Date(iso)).date);
    if (entry) entry[key] += amount;
  };
  for (const o of ordersRes.data ?? []) add(o.completed_at, o.source === "pos" ? "register" : "online", Number(o.total));
  for (const b of bookingsRes.data ?? []) add(b.created_at, "online", b.quantity * Number(b.unit_price) + Number(b.tax_amount));
  for (const r of boothsRes.data ?? []) add(r.created_at, "online", Number(r.fee_amount));

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

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

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
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);
  const now = new Date();

  const [{ data: ingredients, error: ingErr }, { data: orders, error: ordersErr }, { data: counts, error: countsErr }, recipesByItem] =
    await Promise.all([
      supabase.from("ingredients").select("id, name, unit, unit_cost").eq("active", true).order("category").order("name"),
      supabase.from("orders").select("id").eq("status", "completed").gte("created_at", since.toISOString()),
      supabase.from("inventory_counts").select("ingredient_id, quantity_on_hand, counted_at").order("counted_at"),
      getRecipesByItem(),
    ]);
  if (ingErr) throw ingErr;
  if (ordersErr) throw ordersErr;
  if (countsErr) throw countsErr;

  const orderIds = (orders ?? []).map((o) => o.id);
  let orderItems: { menu_item_id: string | null; quantity: number }[] = [];
  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("order_items")
      .select("menu_item_id, quantity")
      .in("order_id", orderIds)
      .not("menu_item_id", "is", null);
    if (error) throw error;
    orderItems = data ?? [];
  }

  const theoreticalByIngredient = new Map<string, number>();
  for (const oi of orderItems) {
    const recipe = oi.menu_item_id ? recipesByItem[oi.menu_item_id] : undefined;
    if (!recipe) continue;
    for (const ri of recipe.ingredients) {
      theoreticalByIngredient.set(ri.ingredient_id, (theoreticalByIngredient.get(ri.ingredient_id) ?? 0) + ri.quantity * oi.quantity);
    }
  }

  const countsByIngredient = new Map<string, { quantity_on_hand: number; counted_at: string }[]>();
  for (const c of counts ?? []) {
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
