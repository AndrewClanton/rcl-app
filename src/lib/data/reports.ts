import { createAdminClient } from "@/lib/supabase/admin";

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
