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
