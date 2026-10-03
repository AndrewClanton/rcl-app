import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyPoints } from "@/lib/points";

// A thank-you for setting up a login on an account we made for them: old-
// site members (imported_at, legacy_user_id) and the Indy import
// (indy_user_id). Paid the first time a claim link attaches a login
// (lib/member-claim.ts), as one 'welcome_bonus' line in their points
// history through applyPoints, so the balance and the history agree.
//
// Once per member, ever: an earlier welcome_bonus line in their history
// means it was already paid. A merge moves the duplicate's whole history
// onto the kept account (merge_members), so a bonus either account had
// still counts after one, and two accounts that both have a login can't be
// merged. claim_member_account attaches a login to an account only once,
// so two claims can't both get here for the same account.
//
// Never throws: the claim itself has already worked, and a missed bonus
// can be added by a manager (Add or take away points).
export const CLAIM_BONUS_POINTS = 100;

export async function awardClaimBonus(memberId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: member, error } = await admin.from("members").select("imported_at, legacy_user_id, indy_user_id, erased_at").eq("id", memberId).maybeSingle();
    if (error || !member || member.erased_at) return;
    if (!member.imported_at && member.legacy_user_id == null && member.indy_user_id == null) return;
    const { data: paid, error: paidErr } = await admin.from("points_ledger").select("id").eq("member_id", memberId).eq("reason", "welcome_bonus").limit(1);
    if (paidErr || paid?.length) return;
    const r = await applyPoints({ memberId, delta: CLAIM_BONUS_POINTS, reason: "welcome_bonus", note: "Welcome bonus for claiming your account" });
    if (!r.ok) console.error("claim bonus not paid for", memberId);
  } catch (e) {
    console.error("claim bonus failed:", e instanceof Error ? e.message : e);
  }
}
