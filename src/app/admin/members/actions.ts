"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff, assertStaff } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import type { MemberPriceTier, MemberTier } from "@/lib/types";
import { applyMemberRate, type RateChangeResult } from "@/lib/member-rate";
import { applyPoints } from "@/lib/points";

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function revalidate() {
  revalidatePath("/admin/members");
  revalidatePath("/admin/reports");
}

export async function addMember(fields: { name: string; email?: string; phone?: string; tier: MemberTier }) {
  await assertStaff();
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
    monthly_member: boolean;
    avatar_url: string | null;
  }>
) {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase.from("members").update(fields).eq("id", id);
  revalidate();
}

// Senior/student rates are set only after checking an ID in person. For a
// paying Insiders+ member this also changes their Stripe price from their
// next bill (see applyMemberRate).
export async function setMemberRate(id: string, tier: MemberPriceTier): Promise<RateChangeResult> {
  const staff = await assertStaff();
  const result = await applyMemberRate(id, tier, staff.employeeId);
  revalidate();
  revalidatePath(`/admin/members/${id}`);
  return result;
}

// Sets a member's balance by hand. Recorded in their points history as an
// adjustment by this staff member, so the member can see what changed.
export async function adjustMemberPoints(id: string, newBalance: number, note?: string) {
  const staff = await assertStaff();
  const { data: member } = await createAdminClient().from("members").select("points").eq("id", id).single();
  if (!member) return;
  const delta = Math.round((newBalance - Number(member.points)) * 100) / 100;
  if (delta) await applyPoints({ memberId: id, delta, reason: "adjustment", note: note?.trim() || "Adjusted by staff", by: staff.employeeId });
  revalidate();
  revalidatePath(`/admin/members/${id}`);
}

export async function deleteMember(id: string) {
  await assertStaff();
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

// Opens Stripe's own hosted billing portal for this member's Stripe
// customer, scoped to update their payment method (or view invoices) --
// staff can hand a tablet to the member and let them enter a new card
// directly into Stripe's PCI-compliant page. We never see or store the
// card number ourselves.
export async function createMemberBillingPortalLink(memberId: string): Promise<{ url: string }> {
  await requireStaff();
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("stripe_customer_id").eq("id", memberId).maybeSingle();
  if (!member?.stripe_customer_id) throw new Error("No billing account on file for this member.");
  const origin = await siteOrigin();
  const session = await getStripe().billingPortal.sessions.create({
    customer: member.stripe_customer_id,
    return_url: `${origin}/admin/members/${memberId}`,
  });
  return { url: session.url };
}
