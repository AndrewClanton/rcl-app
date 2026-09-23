"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";

function revalidate() {
  revalidatePath("/admin/events");
}

export async function markEventPaid(id: string) {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: event } = await supabase.from("events").select("estimate_total").eq("id", id).single();
  if (!event) return;
  await supabase.from("events").update({ deposit_paid: event.estimate_total, balance_due: 0, status: "paid" }).eq("id", id);
  revalidate();
}

export async function markEventOutstanding(id: string) {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: event } = await supabase.from("events").select("estimate_total").eq("id", id).single();
  if (!event) return;
  await supabase.from("events").update({ deposit_paid: 0, balance_due: event.estimate_total, status: "outstanding" }).eq("id", id);
  revalidate();
}

export async function updateEventGuestCount(id: string, guestCount: number | null) {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase.from("events").update({ guest_count: guestCount }).eq("id", id);
  revalidate();
}

export async function deleteEvent(id: string) {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase.from("events").delete().eq("id", id);
  revalidate();
}
