"use server";

import { createAdminClient } from "@/lib/supabase/admin";

function last10Digits(s: string) {
  return s.replace(/\D/g, "").slice(-10);
}

export interface FoundMember {
  name: string;
  avatarUrl: string | null;
  points: number;
  tier: string;
}

// Looks up a member by phone number for the customer-facing kiosk -- self-
// service, no password. Digit-only comparison (stripping formatting) since
// phone numbers are stored as free-text elsewhere in the app. Only reachable
// from a page already gated by requireStaff() (a physical, staff-set-up
// device), and returns just enough to greet someone by name -- no email,
// payment, or contact info.
export async function findMemberByPhone(phone: string): Promise<FoundMember | null> {
  const target = last10Digits(phone);
  if (target.length !== 10) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("members").select("name, phone, avatar_url, points, tier").not("phone", "is", null);
  if (error) throw error;

  const match = (data ?? []).find((m) => m.phone && last10Digits(m.phone) === target);
  if (!match) return null;
  return { name: match.name, avatarUrl: match.avatar_url, points: match.points, tier: match.tier };
}
