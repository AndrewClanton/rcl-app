"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";

// Each returns { ok: false, error } when the database didn't take the
// change, so the screen can say so (it used to look saved either way).
type Result = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/events");
}

async function setPaid(id: string, paid: boolean): Promise<Result> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: event } = await supabase.from("events").select("estimate_total").eq("id", id).maybeSingle();
  if (!event) return { ok: false, error: "That event isn't there anymore. Reload the page." };
  const fields = paid
    ? { deposit_paid: event.estimate_total, balance_due: 0, status: "paid" }
    : { deposit_paid: 0, balance_due: event.estimate_total, status: "outstanding" };
  const { error } = await supabase.from("events").update(fields).eq("id", id);
  if (error) return { ok: false, error: "Couldn't update that event. Try again." };
  revalidate();
  return { ok: true };
}

export async function markEventPaid(id: string): Promise<Result> {
  return setPaid(id, true);
}

export async function markEventOutstanding(id: string): Promise<Result> {
  return setPaid(id, false);
}

export async function updateEventGuestCount(id: string, guestCount: number | null): Promise<Result> {
  await assertStaff();
  if (guestCount !== null && !(Number.isInteger(guestCount) && guestCount >= 0)) return { ok: false, error: "Enter the number of guests (0 or more)." };
  const { error } = await createAdminClient().from("events").update({ guest_count: guestCount }).eq("id", id);
  if (error) return { ok: false, error: "Couldn't save the guest count. Try again." };
  revalidate();
  return { ok: true };
}

export async function deleteEvent(id: string): Promise<Result> {
  await assertStaff();
  const { error } = await createAdminClient().from("events").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete that event. Try again." };
  revalidate();
  return { ok: true };
}
