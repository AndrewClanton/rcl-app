"use server";

import { revalidatePath } from "next/cache";
import { assertStaff, hasManagerAccess } from "@/lib/auth";
import { checkManagerPin } from "@/lib/manager-pin";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSeatStatus } from "@/lib/seat-ordering-server";
import type { SeatStatus } from "@/lib/seat-ordering";

// The register's seat orders (SeatOrders.tsx): Making and Delivered, and the
// Staff panel's on/off switch. Any staff member can switch it off on a night
// the floor is short-handed; switching it on takes a manager (signed in, or
// a manager PIN), as in Back office (code review N22). The list itself is
// read through api/pos/seat-orders (a GET, so the poll never queues ahead of
// a sale).

export async function setRegisterSeatStatus(orderId: string, status: SeatStatus): Promise<boolean> {
  await assertStaff();
  if (status !== "new" && status !== "making" && status !== "delivered") return false;
  return setSeatStatus(orderId, status);
}

export async function setSeatOrderingOn(on: boolean, pin?: string): Promise<{ ok: boolean; needPin?: boolean; error?: string }> {
  const staff = await assertStaff();
  let by: string | null = staff.employeeId || null;
  if (on && !hasManagerAccess(staff.role)) {
    if (!pin) return { ok: false, needPin: true };
    const approval = await checkManagerPin(String(pin), "seat-ordering-on", staff.employeeId);
    if (!approval.ok) return { ok: false, error: approval.error };
    by = approval.approverId ?? by;
  }
  const { error } = await createAdminClient()
    .from("seat_ordering_settings")
    .upsert({ id: 1, enabled: !!on, updated_at: new Date().toISOString(), updated_by: by });
  revalidatePath("/admin/seat-ordering");
  return error ? { ok: false, error: "Didn't save. Try again." } : { ok: true };
}
