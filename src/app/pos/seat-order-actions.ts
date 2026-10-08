"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSeatStatus } from "@/lib/seat-ordering-server";
import type { SeatStatus } from "@/lib/seat-ordering";

// The register's seat orders (SeatOrders.tsx): Making and Delivered, and the
// Staff panel's on/off switch. Any staff member can switch it off on a night
// the floor is short-handed. The list itself is read through
// api/pos/seat-orders (a GET, so the poll never queues ahead of a sale).

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
