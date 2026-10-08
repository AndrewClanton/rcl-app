import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyPoints, reversePurchasePoints } from "@/lib/points";

// Points coming back off a refunded order, shared by the refunds made in the
// app (admin/reports/actions.ts) and the ones made in Stripe's dashboard
// (lib/stripe-refunds.ts, from the webhook).

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Takes back the points a refunded order earned (and returns any it
// redeemed). reverse_purchase_points does that in one go, but only once per
// order: after a partial refund has already taken some back, it would do
// nothing. So once an order has a partial refund (or a card match on it was
// undone, or its points were given to another member after that: see
// lib/member-cards.ts), what each member still holds from it is worked out
// here from the order's points history instead, and taken back.
export async function reverseOrderPoints(orderId: string, by: string | null) {
  const { data: rows, error } = await createAdminClient().from("points_ledger").select("member_id, delta, reason").eq("order_id", orderId);
  if (error || !(rows ?? []).some((r) => r.reason === "refund" || r.reason === "adjustment")) return reversePurchasePoints({ orderId }, by);
  const held = new Map<string, { net: number; refundedBefore: boolean }>();
  for (const r of rows ?? []) {
    if (!["purchase", "redeem", "refund", "adjustment"].includes(r.reason)) continue;
    const cur = held.get(r.member_id) ?? { net: 0, refundedBefore: false };
    cur.net += Number(r.delta);
    if (r.reason === "refund") cur.refundedBefore = true;
    held.set(r.member_id, cur);
  }
  for (const [memberId, h] of held) {
    const rest = round2(-h.net);
    if (rest !== 0) await applyPoints({ memberId, delta: rest, reason: "refund", orderId, note: h.refundedBefore ? "Rest of the purchase refunded" : "Purchase refunded", by: by ?? undefined });
  }
}

// Points back in proportion to the part of an order refunded (share: that
// part over the order's goods), from the member on it now, never more than
// they still hold from it. (Points given for the order after a card match
// was undone are an adjustment tied to it: lib/member-cards.ts.)
export async function takeBackPointsShare(args: { orderId: string; memberId: string; share: number; note: string; by: string | null }) {
  if (!(args.share > 0)) return;
  const { data: rows } = await createAdminClient().from("points_ledger").select("delta, reason").eq("order_id", args.orderId).eq("member_id", args.memberId);
  const earned = (rows ?? []).filter((r) => r.reason === "purchase" || (r.reason === "adjustment" && Number(r.delta) > 0)).reduce((s, r) => s + Number(r.delta), 0);
  const alreadyBack = (rows ?? []).filter((r) => r.reason === "refund").reduce((s, r) => s + Number(r.delta), 0); // negative
  const takeBack = round2(Math.min(earned * args.share, earned + alreadyBack));
  if (takeBack > 0) await applyPoints({ memberId: args.memberId, delta: -takeBack, reason: "refund", orderId: args.orderId, note: args.note, by: args.by ?? undefined });
}
