import { createAdminClient } from "@/lib/supabase/admin";
import { getRecipesByItem } from "./recipes";

export interface ReportOrder {
  id: string;
  order_number: number;
  status: string;
  total: number;
  tip: number;
  payment_method: string | null;
  payment_cash_amount: number | null;
  payment_card_amount: number | null;
  tab_name: string | null;
  created_at: string;
  employee: { name: string } | null;
  items: { name: string; unit_price: number; quantity: number; modifiers: string[]; is_event: boolean }[];
}

const ORDER_SELECT = "*, employee:employees(name), items:order_items(name, unit_price, quantity, modifiers, is_event)";

export async function getTodaysCompletedOrders(): Promise<ReportOrder[]> {
  const supabase = createAdminClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("status", "completed")
    .gte("created_at", startOfDay.toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ReportOrder[];
}

export async function getRecentOrders(limit = 20): Promise<ReportOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .in("status", ["completed", "refunded"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ReportOrder[];
}

export interface RevenueDay {
  date: string;
  pos: number;
  web: number;
  tickets: number;
  total: number;
}

// Day-by-day revenue across POS orders, web (online concessions/membership)
// orders, and general-admission ticket bookings, for the trend chart on
// /admin/reports. Days with no activity are still included (zeroed) so the
// chart's x-axis is continuous.
export async function getRevenueTrend(days: number): Promise<RevenueDay[]> {
  const supabase = createAdminClient();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const [{ data: orders, error: ordersErr }, { data: bookings, error: bookingsErr }] = await Promise.all([
    supabase.from("orders").select("total, source, created_at").eq("status", "completed").gte("created_at", since.toISOString()),
    supabase.from("bookings").select("quantity, unit_price, created_at").eq("status", "confirmed").gte("created_at", since.toISOString()),
  ]);
  if (ordersErr) throw ordersErr;
  if (bookingsErr) throw bookingsErr;

  const byDay = new Map<string, { pos: number; web: number; tickets: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), { pos: 0, web: 0, tickets: 0 });
  }

  for (const o of orders ?? []) {
    const entry = byDay.get(o.created_at.slice(0, 10));
    if (!entry) continue;
    if (o.source === "pos") entry.pos += o.total;
    else entry.web += o.total;
  }
  for (const b of bookings ?? []) {
    const entry = byDay.get(b.created_at.slice(0, 10));
    if (!entry) continue;
    entry.tickets += b.quantity * b.unit_price;
  }

  return [...byDay.entries()].map(([date, v]) => ({ date, ...v, total: v.pos + v.web + v.tickets }));
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

// Central time, fixed -05:00 (CDT) offset -- same simplification the rest
// of the codebase uses for one-off Central-time conversions. Drifts an hour
// during the CST months (roughly early Nov - early Mar); not worth a tz
// library for a same-day cash report a human reviews before moving money.
function centralWindowToUtc(dateStr: string, startTime: string, endTime: string) {
  return {
    start: new Date(`${dateStr}T${startTime}:00-05:00`).toISOString(),
    end: new Date(`${dateStr}T${endTime}:00-05:00`).toISOString(),
  };
}

const DAY_START = "06:30";
const DAY_END = "22:30";
const TAX_RATE = 0.1;
const BOX_OFFICE_PER_TICKET = 4;
const INVENTORY_SHARE = 0.2;
const EXPENSE_SHARE = 0.8;

// Maps a menu_categories.key to which cash-allocation bucket it falls in.
// 'sweet' (candy) and 'tickets' (POS-sold event/day-pass items, distinct
// from the movie-ticket `bookings` table) aren't in Nathan's 4 named
// categories (food/coffee/soda/liquor) -- bucketed as "other" rather than
// silently folded into one of the four, so the report doesn't misrepresent
// what it's including.
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

export interface CashAllocation {
  date: string;
  windowLabel: string;
  ticketCount: number;
  paidTicketCount: number;
  ticketRevenue: number;
  boothRevenue: number;
  categoryRevenue: { food: number; coffee: number; soda: number; liquor: number; other: number };
  totalSales: number;
  taxAccount: number;
  boxOfficeAccount: number;
  inventoryAccount: number;
  expenseAccount: number;
}

// Splits a day's activity (6:30am-10:30pm Central) across the 4 accounts
// Nathan asked for: 10% of total sales to the tax account, $4/paid movie
// ticket to the box office account, and food/coffee/soda/liquor sales split
// 20% inventory-purchasing / 80% expense. These are independent
// calculations, not a sequential waterfall -- e.g. tax is 10% of
// *everything* (including ticket and booth revenue), so the 4 figures
// won't necessarily sum to totalSales. Anything not explicitly covered by
// one of Nathan's rules (net ticket/booth revenue beyond their own
// carve-outs, candy, POS "tickets and events" items) isn't assigned to an
// account here -- shown in categoryRevenue.other instead of guessed at.
export async function getCashAllocationForDate(date: string): Promise<CashAllocation> {
  const supabase = createAdminClient();
  const { start, end } = centralWindowToUtc(date, DAY_START, DAY_END);

  const [{ data: orders, error: ordersErr }, { data: bookings, error: bookingsErr }, { data: boothReservations, error: boothErr }, { data: menuItems, error: menuErr }, { data: categories, error: catErr }] =
    await Promise.all([
      supabase.from("orders").select("id").eq("status", "completed").gte("created_at", start).lt("created_at", end),
      supabase.from("bookings").select("quantity, unit_price").eq("status", "confirmed").gte("created_at", start).lt("created_at", end),
      supabase.from("booth_reservations").select("fee_amount").eq("status", "confirmed").gte("created_at", start).lt("created_at", end),
      supabase.from("menu_items").select("id, category_id"),
      supabase.from("menu_categories").select("id, key"),
    ]);
  if (ordersErr) throw ordersErr;
  if (bookingsErr) throw bookingsErr;
  if (boothErr) throw boothErr;
  if (menuErr) throw menuErr;
  if (catErr) throw catErr;

  const categoryKeyById = new Map((categories ?? []).map((c) => [c.id, c.key]));
  const bucketByMenuItemId = new Map((menuItems ?? []).map((m) => [m.id, CATEGORY_BUCKET[categoryKeyById.get(m.category_id) ?? ""]]));

  const orderIds = (orders ?? []).map((o) => o.id);
  let orderItems: { menu_item_id: string | null; unit_price: number; quantity: number; is_alcohol: boolean }[] = [];
  if (orderIds.length > 0) {
    const { data, error } = await supabase.from("order_items").select("menu_item_id, unit_price, quantity, is_alcohol").in("order_id", orderIds);
    if (error) throw error;
    orderItems = data ?? [];
  }

  const categoryRevenue = { food: 0, coffee: 0, soda: 0, liquor: 0, other: 0 };
  for (const oi of orderItems) {
    const lineTotal = oi.unit_price * oi.quantity;
    const bucket = oi.is_alcohol ? "liquor" : oi.menu_item_id ? bucketByMenuItemId.get(oi.menu_item_id) : undefined;
    categoryRevenue[bucket ?? "other"] += lineTotal;
  }

  const ticketCount = (bookings ?? []).reduce((s, b) => s + b.quantity, 0);
  const paidTicketCount = (bookings ?? []).filter((b) => b.unit_price > 0).reduce((s, b) => s + b.quantity, 0);
  const ticketRevenue = (bookings ?? []).reduce((s, b) => s + b.quantity * b.unit_price, 0);
  const boothRevenue = (boothReservations ?? []).reduce((s, r) => s + r.fee_amount, 0);
  const foodDrinkTotal = categoryRevenue.food + categoryRevenue.coffee + categoryRevenue.soda + categoryRevenue.liquor;
  const totalSales = ticketRevenue + boothRevenue + foodDrinkTotal + categoryRevenue.other;

  return {
    date,
    windowLabel: "6:30 AM – 10:30 PM",
    ticketCount,
    paidTicketCount,
    ticketRevenue,
    boothRevenue,
    categoryRevenue,
    totalSales,
    taxAccount: totalSales * TAX_RATE,
    boxOfficeAccount: paidTicketCount * BOX_OFFICE_PER_TICKET,
    inventoryAccount: foodDrinkTotal * INVENTORY_SHARE,
    expenseAccount: foodDrinkTotal * EXPENSE_SHARE,
  };
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
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todaysOrdersRes, memberCountRes, compedCountRes, screeningsCountRes] = await Promise.all([
    supabase.from("orders").select("total").eq("status", "completed").gte("created_at", startOfDay.toISOString()),
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
