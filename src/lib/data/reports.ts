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
  const { data, error } = await supabase
    .from("members")
    .select("tier, comped, stripe_subscription_id, created_at, community_program:community_programs(name)");
  if (error) throw error;
  const members = (data ?? []) as unknown as {
    tier: string;
    comped: boolean;
    stripe_subscription_id: string | null;
    created_at: string;
    community_program: { name: string } | null;
  }[];

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
      supabase.from("ingredients").select("id, name, unit").eq("active", true).order("category").order("name"),
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
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      theoreticalUsage,
      physicalUsage,
      variance: physicalUsage !== null ? physicalUsage - theoreticalUsage : null,
    };
  });

  return rows.sort((a, b) => b.theoreticalUsage - a.theoreticalUsage);
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
    supabase.from("members").select("id", { count: "exact", head: true }),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("comped", true),
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
