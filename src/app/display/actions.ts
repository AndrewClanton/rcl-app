"use server";

import { createAdminClient } from "@/lib/supabase/admin";

// Shared by the kitchen and bar prep-ticket displays. Gated at the page
// level (requireStaff()) -- low-stakes, no financial or personal data, so
// no extra check here, matching e.g. deleteCalendarNote's minimal shape.
export async function setItemReady(itemId: string, ready: boolean) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("order_items")
    .update({ ready, ready_at: ready ? new Date().toISOString() : null })
    .eq("id", itemId);
  if (error) throw error;
}
