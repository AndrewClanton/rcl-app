import type { Room, RoomAddon } from "@/lib/types";

// Mirrors eventEstimate() in rcl-pos.html: hourly rate * hours, plus a
// one-time cleaning fee, plus any selected add-ons' hourly rate * hours.
export function estimateEventTotal(room: Room, hours: number, selectedAddonIds: string[]): number {
  if (!room.hourly_rate) return 0;
  let total = room.hourly_rate * hours + (room.cleaning_fee ?? 0);
  for (const addon of room.addons) {
    if (selectedAddonIds.includes(addon.id)) total += addon.hourly_rate * hours;
  }
  return total;
}

export function selectedAddons(room: Room, selectedAddonIds: string[]): RoomAddon[] {
  return room.addons.filter((a) => selectedAddonIds.includes(a.id));
}
