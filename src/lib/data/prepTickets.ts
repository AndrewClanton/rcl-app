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
  order_name: string | null; // on a tab, the tab's name
  // A tab (open, or since paid): the board marks it, and a line rung after
  // the tab's first round is an add-on, as on the kitchen's paper ticket.
  tab: boolean;
  add_on: boolean;
  station: Station;
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

function stationFor(categoryKey: string | null, isAlcohol: boolean): Station | null {
  if (categoryKey) {
    if (KITCHEN_CATEGORIES.has(categoryKey)) return "kitchen";
    if (BAR_CATEGORIES.has(categoryKey)) return "bar";
    return null;
  }
  return isAlcohol ? "bar" : "kitchen";
}

// The kitchen's paper ticket timing (lib/print/kitchen.ts): a tab's first
// ticket waits 30 seconds after each line is rung, 90 at most, then prints,
// and whatever is rung after that prints as an ADD-ON. The board marks lines
// by the same timing. Putting a tab away prints its ticket at once, which
// the board can't see, so a line rung within seconds of that isn't marked.
const HOLD_MS = 30_000;
const MAX_HOLD_MS = 90_000;

// When a tab's first round closed, from the times its lines were rung.
function firstRoundEnd(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  const start = sorted[0];
  let end = start + HOLD_MS;
  for (const t of sorted) {
    if (t > end) break;
    end = Math.min(t + HOLD_MS, start + MAX_HOLD_MS);
  }
  return end;
}

// Each tab's first-round end, from all its lines (not just the recent ones
// on the board, so a tab opened hours ago still knows its first round). If
// this can't be read, the board just shows no add-ons.
async function tabFirstRounds(supabase: ReturnType<typeof createAdminClient>, orderIds: string[]): Promise<Map<string, number>> {
  const ends = new Map<string, number>();
  if (!orderIds.length) return ends;
  const { data, error } = await supabase.from("order_items").select("order_id, created_at").in("order_id", orderIds).eq("is_event", false);
  if (error) {
    console.error("prep board: tab lines not read", error.message);
    return ends;
  }
  const times = new Map<string, number[]>();
  for (const row of (data ?? []) as { order_id: string; created_at: string }[]) {
    const list = times.get(row.order_id) ?? [];
    list.push(Date.parse(row.created_at));
    times.set(row.order_id, list);
  }
  for (const [orderId, list] of times) ends.set(orderId, firstRoundEnd(list));
  return ends;
}

// The last couple of hours of items for one prep station, from paid orders
// and open tabs. The window is on each item's own time, so a tab opened
// hours ago still shows what was just added to it.
async function getRecentTickets(board: Board): Promise<PrepTicket[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();

  const { data, error } = await supabase
    .from("order_items")
    .select(
      "id, order_id, name, quantity, modifiers, ready, ready_at, created_at, is_event, is_alcohol, menu_item:menu_items(category:menu_categories(key)), order:orders!inner(order_number, order_name, tab_name, status)"
    )
    .eq("is_event", false)
    .in("order.status", ["completed", "tab"])
    .gte("created_at", since)
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
    order: { order_number: number; order_name: string | null; tab_name: string | null; status: string };
  }[];

  // A tab keeps its name once paid (as the reprint does, lib/print/kitchen.ts).
  const isTab = (order: (typeof rows)[number]["order"]) => order.status === "tab" || !!order.tab_name;

  const shown = rows
    .map((row) => ({ row, station: stationFor(row.menu_item?.category?.key ?? null, row.is_alcohol) }))
    .filter(({ station }) => station !== null && (board === "all" || station === board))
    .slice(0, 60);
  const firstRounds = await tabFirstRounds(supabase, [...new Set(shown.filter(({ row }) => isTab(row.order)).map(({ row }) => row.order_id))]);

  return shown.map(({ row, station }) => {
    const tab = isTab(row.order);
    const firstRound = firstRounds.get(row.order_id);
    return {
      id: row.id,
      order_id: row.order_id,
      name: row.name,
      quantity: row.quantity,
      modifiers: row.modifiers,
      ready: row.ready,
      ready_at: row.ready_at,
      created_at: row.created_at,
      order_number: row.order.order_number,
      order_name: (tab && row.order.tab_name) || row.order.order_name,
      tab,
      add_on: tab && firstRound !== undefined && Date.parse(row.created_at) > firstRound,
      station: station as Station,
    };
  });
}

export function getKitchenTickets() {
  return getRecentTickets("kitchen");
}

export function getBarTickets() {
  return getRecentTickets("bar");
}

export function getAllPrepTickets() {
  return getRecentTickets("all");
}
