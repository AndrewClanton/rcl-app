"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth";
import type { MemberPriceTier, MemberTier } from "@/lib/types";

function revalidate() {
  revalidatePath("/admin/members");
  revalidatePath("/admin/reports");
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

// Comps a membership for a community/social program -- upgrades to
// Insiders+ (the tier with free-entry benefits) at no charge, and tags who
// approved it and which program it's attributed to so nonprofit grant
// reporting can tally participation by program (see /admin/reports).
export async function grantFreeMembership(id: string, fields: { communityProgramId: string | null; notes: string }) {
  const staff = await requireStaff();
  const supabase = createAdminClient();
  await supabase
    .from("members")
    .update({
      tier: "Insiders+",
      comped: true,
      community_program_id: fields.communityProgramId,
      comp_notes: fields.notes.trim() || null,
      comped_by: staff.employeeId,
      comped_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidate();
}

// Only reverts tier to plain Insiders if there's no real paid subscription
// behind it -- a comped member who separately started paying via Stripe
// should keep Insiders+ from their subscription, not lose it here.
export async function revokeFreeMembership(id: string) {
  await requireStaff();
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("stripe_subscription_id").eq("id", id).maybeSingle();
  await supabase
    .from("members")
    .update({
      tier: member?.stripe_subscription_id ? "Insiders+" : "Insiders",
      comped: false,
      community_program_id: null,
      comp_notes: null,
      comped_by: null,
      comped_at: null,
    })
    .eq("id", id);
  revalidate();
}

export async function addCommunityProgram(fields: { name: string; description?: string }) {
  const name = fields.name.trim();
  if (!name) return;
  await requireStaff();
  const supabase = createAdminClient();
  await supabase.from("community_programs").insert({ name, description: fields.description?.trim() || null });
  revalidate();
}

export async function setCommunityProgramActive(id: string, active: boolean) {
  await requireStaff();
  const supabase = createAdminClient();
  await supabase.from("community_programs").update({ active }).eq("id", id);
  revalidate();
}
