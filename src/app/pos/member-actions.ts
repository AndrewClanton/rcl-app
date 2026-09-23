"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { applyMemberRate, type RateChangeResult } from "@/lib/member-rate";
import type { MemberPriceTier, MemberTier } from "@/lib/types";

// What the register needs to know about an attached member -- looked up on
// demand instead of shipping every member's contact details to the register
// page (which also silently stopped at 1,000 members).
export interface PosMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tier: MemberTier;
  points: number;
  comped: boolean;
  subscribed: boolean;
  price_tier: MemberPriceTier | null;
  price_tier_set_at: string | null;
  price_tier_set_by_name: string | null;
}

const POS_MEMBER_SELECT =
  "id, name, email, phone, tier, points, comped, stripe_subscription_id, subscription_status, price_tier, price_tier_set_at, set_by:employees!members_price_tier_set_by_fkey(name)";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tier: MemberTier;
  points: number;
  comped: boolean | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  price_tier: MemberPriceTier | null;
  price_tier_set_at: string | null;
  set_by: { name: string } | { name: string }[] | null;
};

function toPosMember(r: Row): PosMember {
  const setBy = Array.isArray(r.set_by) ? r.set_by[0] : r.set_by;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    tier: r.tier,
    points: Number(r.points),
    comped: !!r.comped,
    subscribed: !!r.stripe_subscription_id && ["active", "trialing", "past_due"].includes(r.subscription_status ?? ""),
    price_tier: r.price_tier,
    price_tier_set_at: r.price_tier_set_at,
    price_tier_set_by_name: setBy?.name ?? null,
  };
}

// A member's QR code (account page) encodes "RCL:<member id>". A USB or
// Bluetooth scanner types that into the search box like a keyboard.
const QR_PATTERN = /^RCL:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function getPosMember(id: string): Promise<PosMember | null> {
  await assertStaff();
  const { data } = await createAdminClient().from("members").select(POS_MEMBER_SELECT).eq("id", id).maybeSingle();
  return data ? toPosMember(data as unknown as Row) : null;
}

// Name, email, phone (any formatting), or a scanned member QR code.
export async function searchPosMembers(query: string): Promise<PosMember[]> {
  await assertStaff();
  const q = query.trim();
  const qr = q.match(QR_PATTERN);
  if (qr) {
    const member = await getPosMember(qr[1]);
    return member ? [member] : [];
  }
  // Characters that would break PostgREST's or() syntax, plus escaped wildcards.
  const text = q.replace(/[,()"*\\]/g, " ").replace(/[%_]/g, (c) => `\\${c}`).trim();
  if (text.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const filters = [`name.ilike.%${text}%`, `email.ilike.%${text}%`];
  if (digits.length >= 3) filters.push(`phone_digits.like.%${digits}%`);

  const { data, error } = await createAdminClient().from("members").select(POS_MEMBER_SELECT).or(filters.join(",")).order("name").limit(8);
  if (error) return [];
  return (data as unknown as Row[]).map(toPosMember);
}

// Only after checking the person's ID in person. `employeeId` is whoever is
// signed in to the register's employee picker, falling back to the logged-in
// staff account.
export async function setPosMemberRate(
  memberId: string,
  tier: MemberPriceTier,
  employeeId: string | null
): Promise<RateChangeResult & { member?: PosMember | null }> {
  const staff = await assertStaff();
  const result = await applyMemberRate(memberId, tier, employeeId || staff.employeeId);
  revalidatePath("/admin/members");
  if (!result.ok) return result;
  return { ...result, member: await getPosMember(memberId) };
}
