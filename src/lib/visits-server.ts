import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { applyPoints } from "@/lib/points";
import { REWARD_LABEL, visitPoints, visitReward, type RewardKind, type VisitResult } from "@/lib/visits";

// Records a confirmed check-in as today's visit and pays its streak points
// (and any streak reward). Once per member per business day: a second
// check-in today changes nothing and says so. Two registers confirming the
// same person at once can't both pay: the visit row is unique per day.
export async function recordVisit(memberId: string, confirmedBy: string | null): Promise<VisitResult | null> {
  const supabase = createAdminClient();
  const date = businessDay().date;

  const { data: visit, error } = await supabase
    .from("member_visits")
    .insert({ member_id: memberId, business_date: date, confirmed_by: confirmedBy })
    .select("id")
    .single();
  const already = error?.code === "23505";
  if (error && !already) return null;

  const [{ data: streakData }, { count }] = await Promise.all([
    supabase.rpc("member_visit_streak", { p_member: memberId, p_date: date }),
    supabase.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", memberId),
  ]);
  const streak = Math.max(1, Number(streakData) || 1);

  if (already || !visit) {
    const { data: m } = await supabase.from("members").select("points").eq("id", memberId).maybeSingle();
    return { earned: 0, streak, alreadyToday: true, reward: null, balance: Number(m?.points ?? 0), visits: count ?? 0 };
  }

  const earned = visitPoints(streak);
  const paid = await applyPoints({ memberId, delta: earned, reason: "visit", note: `Checked in · day ${streak} of their streak`, by: confirmedBy });
  await supabase.from("member_visits").update({ streak, points_awarded: paid.ok ? earned : 0 }).eq("id", visit.id);

  let reward: RewardKind | null = visitReward(streak);
  if (reward) {
    const { error: rewardErr } = await supabase
      .from("member_rewards")
      .insert({ member_id: memberId, kind: reward, reason: `${streak}-day streak`, earned_on: date });
    if (rewardErr) reward = null;
  }

  let balance: number;
  if (paid.ok) balance = paid.balance;
  else {
    const { data: m } = await supabase.from("members").select("points").eq("id", memberId).maybeSingle();
    balance = Number(m?.points ?? 0);
  }
  return { earned: paid.ok ? earned : 0, streak, alreadyToday: false, reward, balance, visits: count ?? 1 };
}

export interface OpenReward {
  id: string;
  kind: RewardKind;
  label: string;
  reason: string;
  earnedOn: string;
}

export async function openRewards(memberId: string): Promise<OpenReward[]> {
  const { data } = await createAdminClient()
    .from("member_rewards")
    .select("id, kind, reason, earned_on")
    .eq("member_id", memberId)
    .is("redeemed_at", null)
    .order("earned_on");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as RewardKind,
    label: REWARD_LABEL[r.kind as RewardKind] ?? String(r.kind),
    reason: r.reason as string,
    earnedOn: r.earned_on as string,
  }));
}

// Marks a reward used. False if it was already used (say, on the other register).
export async function redeemReward(id: string, by: string | null): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("member_rewards")
    .update({ redeemed_at: new Date().toISOString(), redeemed_by: by })
    .eq("id", id)
    .is("redeemed_at", null)
    .select("id");
  return !!data?.length;
}

export async function unredeemReward(id: string): Promise<void> {
  await createAdminClient().from("member_rewards").update({ redeemed_at: null, redeemed_by: null }).eq("id", id);
}

// Who's checked in today (business day), newest first, with their streak.
export async function todaysVisitors(): Promise<{ memberId: string; at: string; streak: number | null }[]> {
  const { data } = await createAdminClient()
    .from("member_visits")
    .select("member_id, checked_in_at, streak")
    .eq("business_date", businessDay().date)
    .order("checked_in_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((v) => ({ memberId: v.member_id as string, at: v.checked_in_at as string, streak: (v.streak as number | null) ?? null }));
}
