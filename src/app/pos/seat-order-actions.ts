"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSeatSettings, openSeatOrders, setSeatStatus, type OpenSeatOrder } from "@/lib/seat-ordering-server";
import { openStateLabel, seatOrderingOpen, type SeatStatus } from "@/lib/seat-ordering";

// The register's seat orders (SeatOrders.tsx): the list and badge, Making
// and Delivered, and the Staff panel's on/off switch. Any staff member can
// switch it off on a night the floor is short-handed.

export interface RegisterSeatOrders {
  enabled: boolean;
  open: boolean;
  label: string;
  orders: OpenSeatOrder[];
}

export async function getRegisterSeatOrders(): Promise<RegisterSeatOrders> {
  await assertStaff();
  const settings = await getSeatSettings();
  const state = seatOrderingOpen(settings);
  const orders = await openSeatOrders().catch(() => []);
  return { enabled: settings.enabled, open: state.open, label: openStateLabel(settings, state), orders };
}

export async function setRegisterSeatStatus(orderId: string, status: SeatStatus): Promise<boolean> {
  await assertStaff();
  if (status !== "new" && status !== "making" && status !== "delivered") return false;
  return setSeatStatus(orderId, status);
}

export async function setSeatOrderingOn(on: boolean): Promise<{ ok: boolean }> {
  const staff = await assertStaff();
  const { error } = await createAdminClient()
    .from("seat_ordering_settings")
    .upsert({ id: 1, enabled: !!on, updated_at: new Date().toISOString(), updated_by: staff.employeeId || null });
  revalidatePath("/admin/seat-ordering");
  return { ok: !error };
}
