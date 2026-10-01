import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Every change to a member's points goes through here, so the balance and
// the history members see on their account always agree (both are written
// in one database transaction by apply_member_points).

export { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";

// visit and badge: check-ins and their badges, paid by award_member_visit
// in the database (lib/visits-server.ts), not through applyPoints.
// adjustment: staff adding or taking away points, through adjustPoints.
// merge: points brought over from a duplicate account.
// backfill: card purchases from before the new system, paid once per card by
// grant_fortis_backfill (Back office > Members > Points from past card
// purchases), which calls apply_member_points itself.
export type PointsReason = "purchase" | "redeem" | "refund" | "welcome_bonus" | "adjustment" | "opening_balance" | "visit" | "badge" | "merge" | "backfill";

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

// A staff member adding or taking away points by hand, with a reason the
// member sees. One 'adjustment' row through apply_member_points (see
// adjust_member_points, migration 20261001170000), written only if the
// balance is still `expected`, the one the person confirmed, and never
// taking it below zero. A second press of the same button comes back
// "duplicate" and writes nothing.
export type AdjustStatus = "ok" | "duplicate" | "stale" | "negative" | "not_found" | "error";

export async function adjustPoints(args: {
  memberId: string;
  delta: number;
  note: string;
  by: string;
  expected: number;
}): Promise<{ status: AdjustStatus; balance: number | null }> {
  const { data, error } = await createAdminClient().rpc("adjust_member_points", {
    p_member: args.memberId,
    p_delta: args.delta,
    p_note: args.note,
    p_by: args.by,
    p_expected: args.expected,
  });
  if (error || !data || typeof data !== "object") {
    if (error) console.error("adjust_member_points failed", error.code, error.message);
    return { status: "error", balance: null };
  }
  const r = data as { status?: string; balance?: number | string | null };
  const known: AdjustStatus[] = ["ok", "duplicate", "stale", "negative", "not_found"];
  const status = known.includes(r.status as AdjustStatus) ? (r.status as AdjustStatus) : "error";
  return { status, balance: r.balance === null || r.balance === undefined ? null : Number(r.balance) };
}

// Undo what a refunded purchase earned (and give back what it redeemed).
export async function reversePurchasePoints(ref: { orderId?: string; bookingId?: string }, by?: string | null) {
  await createAdminClient().rpc("reverse_purchase_points", {
    p_order: ref.orderId ?? null,
    p_booking: ref.bookingId ?? null,
    p_by: by ?? null,
  });
}
