"use server";

import { assertStaff } from "@/lib/auth";
import { checkRewardForOrder, type OrderRewardCheck } from "@/lib/rewards-server";
import { currentMemberId } from "@/lib/member-forward";
import { isUuid } from "@/lib/rewards";

// The guest tapped Use on a good (or the $5 off) on the customer screen;
// the register asks here before it goes on the order: still offered,
// within its limits (counting the order's other reward lines), and covered
// by their points after what the order already uses. The points come off
// only when the sale is saved (completeOrder).
export async function checkOrderReward(args: {
  memberId: string;
  rewardId: string;
  pending: { rewardId: string; qty: number }[];
  pendingPoints: number;
  discountOn: boolean;
}): Promise<OrderRewardCheck> {
  await assertStaff();
  if (!isUuid(args?.memberId) || !isUuid(args?.rewardId)) return { ok: false, error: "That reward couldn't be read." };
  const memberId = (await currentMemberId(args.memberId)) ?? args.memberId;
  const pending = (Array.isArray(args.pending) ? args.pending : [])
    .filter((p) => isUuid(p?.rewardId) && Number.isInteger(p.qty) && p.qty > 0)
    .slice(0, 50)
    .map((p) => ({ rewardId: p.rewardId, qty: Math.min(p.qty, 20) }));
  const pendingPoints = Number.isFinite(args.pendingPoints) ? Math.max(0, args.pendingPoints) : 0;
  return checkRewardForOrder(memberId, args.rewardId, pending, pendingPoints, !!args.discountOn);
}
