"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setMarketingOptIn } from "@/lib/email/consent";

// Staff switching a member's marketing email on or off, for someone who
// asked in person or on the phone. Recorded with who did it (consent
// source 'staff'). Staff can't lift a spam-complaint block: only the
// member turning email back on themselves does that.
export async function setMemberEmailOptIn(id: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await assertStaff();
  const { data: m } = await createAdminClient().from("members").select("email").eq("id", id).is("erased_at", null).maybeSingle();
  if (!m) return { ok: false, error: "Member not found." };
  if (on && !m.email) return { ok: false, error: "Add their email first." };
  const r = await setMarketingOptIn(id, on === true, "staff", { byEmployee: staff.employeeId });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/admin/members/${id}`);
  return { ok: true };
}
