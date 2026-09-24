"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";

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
// phone numbers are stored as free-text elsewhere in the app. The kiosk
// page is gated by requireStaff() (a physical, staff-set-up device), and
// assertStaff() re-checks here so the lookup can't be called directly as a
// phone-number-to-member-name oracle. Returns just enough to greet someone
// by name -- no email, payment, or contact info.
export async function findMemberByPhone(phone: string): Promise<FoundMember | null> {
  await assertStaff();
  const target = last10Digits(phone);
  if (target.length !== 10) return null;

  // phone_digits is the stored phone with formatting stripped (it may carry
  // a leading country code, hence the suffix match).
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("members").select("name, phone, avatar_url, points, tier").like("phone_digits", `%${target}`).limit(5);
  if (error) throw error;

  const match = (data ?? []).find((m) => m.phone && last10Digits(m.phone) === target);
  if (!match) return null;
  return { name: match.name, avatarUrl: match.avatar_url, points: match.points, tier: match.tier };
}
