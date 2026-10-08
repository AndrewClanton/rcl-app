import { createAdminClient } from "@/lib/supabase/admin";
import { schemaMissing } from "@/lib/schema-missing";
import { seatTicketOf, type SeatOrderCols, type SeatTicket } from "@/lib/seat-ordering";

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
  station: Station;
  // The menu item it was rung up as (null for a custom line), so the bar
  // board can show its drink icon and recipe (lib/data/barBook.ts).
  menu_item_id: string | null;
  // A Bar Book drink rung up off the menu: its recipe (null otherwise, and
  // before migration 20261004030000_order_item_recipe.sql).
  recipe_id: string | null;
  // A custom drink from "What's in it?": its ingredient list (null
  // otherwise, and before migration 20261005010000).
  custom_recipe: unknown;
  // An order from a guest's phone (lib/seat-ordering.ts): where it goes,
  // where it's at, the "ID check" flag and the guest's note. Null for a
  // register order.
  seat: SeatTicket | null;
  is_alcohol?: boolean;
}

export type Station = "kitchen" | "bar";
// A board shows one station, or both at once (the kitchen and bar sit side
// by side, so one screen can serve both).
export type Board = Station | "all";

// Which prep station an item belongs to, by its menu category -- food goes
// to the kitchen, everything poured/mixed/brewed goes to the bar. Candy and
// event/ticket items need no prep, so they route to neither and never show
// up on a ticket board. Items with no menu_item_id (a manual/custom line)
// fall back to is_alcohol, the one classification every order_item already
// carries regardless of whether it came from a real menu item.
const KITCHEN_CATEGORIES = new Set(["grub"]);
const BAR_CATEGORIES = new Set(["beer", "wine", "cocktails", "shots", "spirits", "caffe", "rad"]);

// A seat order's item that needs no making (candy) still has to be carried
// out, so it goes to the bar's board.
function stationFor(categoryKey: string | null, isAlcohol: boolean, seatOrder = false): Station | null {
  if (categoryKey) {
    if (KITCHEN_CATEGORIES.has(categoryKey)) return "kitchen";
    if (BAR_CATEGORIES.has(categoryKey)) return "bar";
    return seatOrder ? "bar" : null;
  }
  return isAlcohol ? "bar" : "kitchen";
}

// Last couple hours of completed POS orders' items for one prep station.
async function getRecentTickets(board: Board): Promise<PrepTicket[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();

  const read = (extra: string, seat = SEAT_COLS) =>
    supabase
      .from("order_items")
      .select(
        `id, order_id, name, quantity, modifiers, ready, ready_at, created_at, is_event, is_alcohol, menu_item_id${extra}, menu_item:menu_items(category:menu_categories(key)), order:orders!inner(order_number, order_name, status, created_at${seat})`
      )
      .eq("is_event", false)
      .eq("order.status", "completed")
      .gte("order.created_at", since)
      .order("created_at", { ascending: false })
      .limit(120);
  let { data, error } = await read(", recipe_id, custom_recipe");
  // Before migration 20261007020000_seat_ordering.sql: no seat orders yet.
  if (error && schemaMissing(error)) ({ data, error } = await read(", recipe_id, custom_recipe", ""));
  if (error && schemaMissing(error)) ({ data, error } = await read(", recipe_id", ""));
  if (error && schemaMissing(error)) ({ data, error } = await read("", ""));
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
    menu_item_id: string | null;
    recipe_id?: string | null;
    custom_recipe?: unknown;
    menu_item: { category: { key: string } | null } | null;
    order: { order_number: number; order_name: string | null } & SeatOrderCols;
  }[];

  return rows
    .map((row) => ({ row, station: stationFor(row.menu_item?.category?.key ?? null, row.is_alcohol, row.order.source === "mobile") }))
    .filter(({ station }) => station !== null && (board === "all" || station === board))
    .slice(0, 60)
    .map(({ row, station }) => ({
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
      station: station as Station,
      menu_item_id: row.menu_item_id ?? null,
      recipe_id: row.recipe_id ?? null,
      custom_recipe: row.custom_recipe ?? null,
      is_alcohol: !!row.is_alcohol,
      seat: seatTicketOf(row.order),
    }));
}

const SEAT_COLS = ", source, spot_name, seat_status, id_check, seat_note";

export function getKitchenTickets() {
  return getRecentTickets("kitchen");
}

export function getBarTickets() {
  return getRecentTickets("bar");
}

export function getAllPrepTickets() {
  return getRecentTickets("all");
}
