import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyPoints } from "@/lib/points";

// A thank-you for setting up a login on an account we made for them: old-
// site members and the Indy import (both have members.imported_at). Paid
// once per member, the first time a claim link attaches a login
// (lib/member-claim.ts); an earlier welcome_bonus in their points history
// means it was already paid. Never throws: the claim itself has already
// worked, and a missed bonus can be added by hand.
export const CLAIM_BONUS_POINTS = 100;

export async function awardClaimBonus(memberId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: member, error } = await admin.from("members").select("imported_at, erased_at").eq("id", memberId).maybeSingle();
    if (error || !member?.imported_at || member.erased_at) return;
    const { data: paid, error: paidErr } = await admin.from("points_ledger").select("id").eq("member_id", memberId).eq("reason", "welcome_bonus").limit(1);
    if (paidErr || paid?.length) return;
    const r = await applyPoints({ memberId, delta: CLAIM_BONUS_POINTS, reason: "welcome_bonus", note: "Welcome bonus for claiming your account" });
    if (!r.ok) console.error("claim bonus not paid for", memberId);
  } catch (e) {
    console.error("claim bonus failed:", e instanceof Error ? e.message : e);
  }
}
