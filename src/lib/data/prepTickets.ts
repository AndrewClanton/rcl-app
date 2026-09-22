import { createAdminClient } from "@/lib/supabase/admin";

export interface PrepTicket {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  modifiers: string[];
  ready: boolean;
  ready_at: string | null;
  created_at: string;
  order_number: number;
  order_name: string | null;
}

export type Station = "kitchen" | "bar";

// Which prep station an item belongs to, by its menu category -- food goes
// to the kitchen, everything poured/mixed/brewed goes to the bar. Candy and
// event/ticket items need no prep, so they route to neither and never show
// up on a ticket board. Items with no menu_item_id (a manual/custom line)
// fall back to is_alcohol, the one classification every order_item already
// carries regardless of whether it came from a real menu item.
const KITCHEN_CATEGORIES = new Set(["grub"]);
const BAR_CATEGORIES = new Set(["beer", "wine", "cocktails", "shots", "spirits", "caffe", "rad"]);

function stationFor(categoryKey: string | null, isAlcohol: boolean): Station | null {
  if (categoryKey) {
    if (KITCHEN_CATEGORIES.has(categoryKey)) return "kitchen";
    if (BAR_CATEGORIES.has(categoryKey)) return "bar";
    return null;
  }
  return isAlcohol ? "bar" : "kitchen";
}

// Last couple hours of completed POS orders' items for one prep station.
async function getRecentTickets(station: Station): Promise<PrepTicket[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();

  const { data, error } = await supabase
    .from("order_items")
    .select(
      "id, order_id, name, quantity, modifiers, ready, ready_at, created_at, is_event, is_alcohol, menu_item:menu_items(category:menu_categories(key)), order:orders!inner(order_number, order_name, status, created_at)"
    )
    .eq("is_event", false)
    .eq("order.status", "completed")
    .gte("order.created_at", since)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    id: string;
    order_id: string;
    name: string;
    quantity: number;
    modifiers: string[];
    ready: boolean;
    ready_at: string | null;
    created_at: string;
    is_alcohol: boolean;
    menu_item: { category: { key: string } | null } | null;
    order: { order_number: number; order_name: string | null };
  }[];

  return rows
    .filter((row) => stationFor(row.menu_item?.category?.key ?? null, row.is_alcohol) === station)
    .slice(0, 60)
    .map((row) => ({
      id: row.id,
      order_id: row.order_id,
      name: row.name,
      quantity: row.quantity,
      modifiers: row.modifiers,
      ready: row.ready,
      ready_at: row.ready_at,
      created_at: row.created_at,
      order_number: row.order.order_number,
      order_name: row.order.order_name,
    }));
}

export function getKitchenTickets() {
  return getRecentTickets("kitchen");
}

export function getBarTickets() {
  return getRecentTickets("bar");
}
