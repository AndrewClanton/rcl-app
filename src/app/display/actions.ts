"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { reprintKitchenTicket, type ReprintResult } from "@/lib/print/kitchen";

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

// "Reprint ticket" on a board card: that order's whole ticket again, on the
// kitchen printer (lib/print/kitchen.ts).
export async function reprintOrderTicket(orderId: string): Promise<ReprintResult> {
  const staff = await assertStaff();
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) return { ok: false, error: "That order isn't there anymore." };
  if (!(await allowAttempt(`kitchen-reprint:${staff.employeeId}`, 20, 60))) return { ok: false, error: "Too many reprints in a minute. Wait a moment." };
  return reprintKitchenTicket(orderId, staff.employeeId);
}
