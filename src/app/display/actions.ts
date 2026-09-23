"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";

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
