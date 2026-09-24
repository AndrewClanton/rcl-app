import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Every change to a member's points goes through here, so the balance and
// the history members see on their account always agree (both are written
// in one database transaction by apply_member_points).

export { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";

export type PointsReason = "purchase" | "redeem" | "refund" | "welcome_bonus" | "adjustment" | "opening_balance";

export async function applyPoints(args: {
  memberId: string;
  delta: number;
  reason: PointsReason;
  orderId?: string | null;
  bookingId?: string | null;
  note?: string | null;
  by?: string | null;
}): Promise<{ ok: true; balance: number } | { ok: false; duplicate: boolean }> {
  if (!args.delta) return { ok: false, duplicate: false };
  const { data, error } = await createAdminClient().rpc("apply_member_points", {
    p_member: args.memberId,
    p_delta: Math.round(args.delta * 100) / 100,
    p_reason: args.reason,
    p_order: args.orderId ?? null,
    p_booking: args.bookingId ?? null,
    p_note: args.note ?? null,
    p_by: args.by ?? null,
  });
  // 23505: this purchase already earned its points (e.g. a retried webhook).
  if (error) return { ok: false, duplicate: error.code === "23505" };
  return { ok: true, balance: Number(data) };
}

// Undo what a refunded purchase earned (and give back what it redeemed).
export async function reversePurchasePoints(ref: { orderId?: string; bookingId?: string }, by?: string | null) {
  await createAdminClient().rpc("reverse_purchase_points", {
    p_order: ref.orderId ?? null,
    p_booking: ref.bookingId ?? null,
    p_by: by ?? null,
  });
}
