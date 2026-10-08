"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { reprintKitchenTicket, type ReprintResult } from "@/lib/print/kitchen";
import { setSeatStatus } from "@/lib/seat-ordering-server";
import type { SeatStatus } from "@/lib/seat-ordering";

// Shared by the kitchen and bar prep-ticket displays. The pages are gated
// by requireStaff(), so those screens carry a staff session -- the action
// re-checks it since a page gate doesn't cover a direct POST.
export async function setItemReady(itemId: string, ready: boolean) {
  await assertStaff();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("order_items")
    .update({ ready, ready_at: ready ? new Date().toISOString() : null })
    .eq("id", itemId);
  if (error) throw error;
}

// A seat order's Making / Delivered on a board card (lib/seat-ordering-server.ts).
// The guest's phone shows the same step.
export async function setSeatOrderStatus(orderId: string, status: SeatStatus): Promise<boolean> {
  await assertStaff();
  if (status !== "new" && status !== "making" && status !== "delivered") return false;
  return setSeatStatus(orderId, status);
}

// "Reprint ticket" on a board card: that order's whole ticket again, on the
// kitchen printer (lib/print/kitchen.ts).
export async function reprintOrderTicket(orderId: string): Promise<ReprintResult> {
  const staff = await assertStaff();
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) return { ok: false, error: "That order isn't there anymore." };
  if (!(await allowAttempt(`kitchen-reprint:${staff.employeeId}`, 20, 60))) return { ok: false, error: "Too many reprints in a minute. Wait a moment." };
  return reprintKitchenTicket(orderId, staff.employeeId);
}
