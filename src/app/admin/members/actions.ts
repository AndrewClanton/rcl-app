"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberPriceTier, MemberTier } from "@/lib/types";

function revalidate() {
  revalidatePath("/admin/members");
}

export async function addMember(fields: { name: string; email?: string; phone?: string; tier: MemberTier }) {
  const name = fields.name.trim();
  if (!name) return;
  const supabase = createAdminClient();
  await supabase.from("members").insert({
    name,
    email: fields.email?.trim() || null,
    phone: fields.phone?.trim() || null,
    tier: fields.tier,
  });
  revalidate();
}

export async function updateMember(
  id: string,
  fields: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
    tier: MemberTier;
    points: number;
    monthly_member: boolean;
    price_tier: MemberPriceTier | null;
  }>
) {
  const supabase = createAdminClient();
  await supabase.from("members").update(fields).eq("id", id);
  revalidate();
}

export async function deleteMember(id: string) {
  const supabase = createAdminClient();
  await supabase.from("members").delete().eq("id", id);
  revalidate();
}
