import { createClient } from "@/lib/supabase/server";
import type { Room, RoomAddon } from "@/lib/types";

export async function getRooms(): Promise<Room[]> {
  const supabase = await createClient();

  const [{ data: rooms, error: roomErr }, { data: addons, error: addonErr }] = await Promise.all([
    supabase.from("rooms").select("*").order("hourly_rate"),
    supabase.from("room_addons").select("*").order("sort_order"),
  ]);

  if (roomErr) throw roomErr;
  if (addonErr) throw addonErr;

  const addonsByRoom = new Map<string, RoomAddon[]>();
  for (const a of addons ?? []) {
    const list = addonsByRoom.get(a.room_id) ?? [];
    list.push(a);
    addonsByRoom.set(a.room_id, list);
  }

  return (rooms ?? []).map((r) => ({ ...r, addons: addonsByRoom.get(r.id) ?? [] }));
}
