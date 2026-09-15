import { createAdminClient } from "@/lib/supabase/admin";

export interface KitchenTicket {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  modifiers: string[];
  created_at: string;
  order_number: number;
  order_name: string | null;
}

// Last couple hours of completed POS orders' items, food/drink prep view.
export async function getRecentKitchenTickets(): Promise<KitchenTicket[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();

  const { data, error } = await supabase
    .from("order_items")
    .select("id, order_id, name, quantity, modifiers, created_at, is_event, order:orders!inner(order_number, order_name, status, created_at)")
    .eq("is_event", false)
    .eq("order.status", "completed")
    .gte("order.created_at", since)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const order = row.order as unknown as { order_number: number; order_name: string | null };
    return {
      id: row.id,
      order_id: row.order_id,
      name: row.name,
      quantity: row.quantity,
      modifiers: row.modifiers,
      created_at: row.created_at,
      order_number: order.order_number,
      order_name: order.order_name,
    };
  });
}
