"use server";

import { assertStaff } from "@/lib/auth";
import { checkRewardForOrder, type OrderRewardCheck } from "@/lib/rewards-server";
import { currentMemberId } from "@/lib/member-forward";
import { isUuid } from "@/lib/rewards";
import { checkManagerPin } from "@/lib/manager-pin";
import { POINTS_PER_REWARD } from "@/lib/points";

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

// Just before payment: every reward line on the order checked together
// (the balance after the $5 off and the lines before it, the per-reward and
// goods limits, stock). problems: what's short, for the manager PIN prompt
// (code review N12). ok when there's nothing to check.
export async function checkRewardsBeforePay(args: { memberId: string; rewards: { rewardId: string; qty: number }[]; discountOn: boolean }): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  await assertStaff();
  if (!isUuid(args?.memberId)) return { ok: true };
  const memberId = (await currentMemberId(args.memberId)) ?? args.memberId;
  const lines = (Array.isArray(args.rewards) ? args.rewards : []).filter((r) => isUuid(r?.rewardId) && Number.isInteger(r.qty) && r.qty > 0).slice(0, 50);
  const pending: { rewardId: string; qty: number }[] = [];
  let pendingPoints = args.discountOn ? POINTS_PER_REWARD : 0;
  const problems: string[] = [];
  for (const l of lines) {
    for (let n = 0; n < Math.min(l.qty, 20); n++) {
      const r = await checkRewardForOrder(memberId, l.rewardId, pending, pendingPoints, !!args.discountOn);
      if (!r.ok) {
        problems.push(r.error);
        break;
      }
      pendingPoints += r.points;
      const same = pending.find((p) => p.rewardId === l.rewardId);
      if (same) same.qty += 1;
      else pending.push({ rewardId: l.rewardId, qty: 1 });
    }
  }
  return problems.length ? { ok: false, problems: [...new Set(problems)] } : { ok: true };
}

// A manager lets a sale with a short reward go ahead (the sale is flagged
// for them afterwards anyway).
export async function approveShortRewards(pin: string): Promise<{ ok: true; approvedBy: string | null } | { ok: false; error: string }> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(String(pin ?? ""), "reward-short", staff.employeeId);
  if (!approval.ok) return { ok: false, error: approval.error };
  return { ok: true, approvedBy: approval.approvedBy };
}
