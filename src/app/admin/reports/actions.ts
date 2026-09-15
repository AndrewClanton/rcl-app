"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPin } from "@/lib/pin";

export async function verifyManagerPin(pin: string): Promise<boolean> {
  if (!pin) return false;
  const supabase = createAdminClient();
  const { data: managers } = await supabase.from("employees").select("pin_hash").in("role", ["manager", "admin"]).eq("active", true);
  return (managers ?? []).some((m) => verifyPin(pin, m.pin_hash));
}

export async function refundOrder(orderId: string, pin: string) {
  const ok = await verifyManagerPin(pin);
  if (!ok) throw new Error("Incorrect manager PIN.");
  const supabase = createAdminClient();
  const { error } = await supabase.from("orders").update({ status: "refunded" }).eq("id", orderId);
  if (error) throw error;
  revalidatePath("/admin/reports");
}
