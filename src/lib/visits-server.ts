import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  REWARD_LABEL,
  VISIT_POINTS,
  badgeFor,
  badgesFor,
  earnedBadge,
  recentWeeks,
  visitBusinessDate,
  weekStart,
  type BadgeKey,
  type EarnedBadge,
  type RewardKind,
  type VisitResult,
} from "@/lib/visits";

// Records a confirmed check-in as today's visit and pays it: VISIT_POINTS,
// plus any badges it earns (lib/visits.ts) and their rewards. Once per
// member per business day: a second check-in today changes nothing and
// says so.
//
// Never pays twice. The visit row is unique per member and day, so two
// registers confirming the same person at once make one visit; the payment
// (award_member_visit, one database transaction) locks the visit and pays
// it only if it hasn't been paid, and each badge only if it's new. A visit
// whose payment didn't go through (the connection dropped) is paid by the
// next check-in that day, so trying again fixes it.
//
// `at` is for the checks in scripts/ (a visit on another day); the app
// always records now.
export async function recordVisit(memberId: string, confirmedBy: string | null, at = new Date()): Promise<VisitResult | null> {
  const supabase = createAdminClient();
  const date = visitBusinessDate(at);

  const { data: inserted, error } = await supabase
    .from("member_visits")
    .insert({ member_id: memberId, business_date: date, checked_in_at: at.toISOString(), confirmed_by: confirmedBy })
    .select("id, checked_in_at, points_awarded")
    .single();
  if (error && error.code !== "23505") return null;
  let visit = inserted;
  if (!visit) {
    // Checked in already today.
    const { data } = await supabase.from("member_visits").select("id, checked_in_at, points_awarded").eq("member_id", memberId).eq("business_date", date).maybeSingle();
    if (!data) return null;
    visit = data;
  }

  const [streakRes, countRes, memberRes] = await Promise.all([
    supabase.rpc("member_week_streak", { p_member: memberId, p_date: date }),
    supabase.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", memberId).lte("business_date", date),
    supabase.from("members").select("points, birthday").eq("id", memberId).maybeSingle(),
  ]);
  const weekStreak = Math.max(0, Math.round(Number(streakRes.data) || 0));
  const visits = countRes.count ?? 0;
  const already = (balance: number): VisitResult => ({ earned: 0, visitPoints: 0, badges: [], rewards: [], weekStreak, alreadyToday: true, balance, visits });

  if (visit.points_awarded !== null) return already(Number(memberRes.data?.points ?? 0));
  // Can't tell which badges it earns: leave it unpaid for a retry to pay.
  if (streakRes.error || countRes.error || !memberRes.data) return null;

  const claims = badgesFor({ at: new Date(visit.checked_in_at as string), visitNumber: visits, weekStreak, birthday: (memberRes.data.birthday as string | null) ?? null });
  const payload = claims.flatMap((c) => {
    const b = badgeFor(c.key);
    if (!b) return [];
    const reason = `${b.label} badge${b.weeks ? `: ${b.weeks} weeks in a row` : ""}`;
    return [{ key: b.key, period: c.period, points: b.points, reward: b.reward ?? null, note: b.label, reason }];
  });
  const { data: award, error: awardErr } = await supabase.rpc("award_member_visit", {
    p_visit: visit.id,
    p_points: VISIT_POINTS,
    p_week_streak: weekStreak,
    p_badges: payload,
    p_by: confirmedBy,
  });
  if (awardErr || !award) return null;
  const a = award as { paid: boolean; balance: number | string; badges: string[] };
  // Paid a moment ago by another register (or this one, twice).
  if (!a.paid) return already(Number(a.balance));

  const badges: EarnedBadge[] = (a.badges ?? []).flatMap((key) => {
    const b = badgeFor(key);
    return b ? [earnedBadge(b)] : [];
  });
  const rewards = badges.flatMap((b): RewardKind[] => (b.reward ? [b.reward] : []));
  const earned = VISIT_POINTS + badges.reduce((s, b) => s + b.points, 0);
  return { earned, visitPoints: VISIT_POINTS, badges, rewards, weekStreak, alreadyToday: false, balance: Number(a.balance), visits };
}

// Today's visit, for the register's pop-up when someone checks in at the
// customer screen: what it paid (null: not paid yet), their week streak,
// how many visits they've made (1: their first), and the badges it earned.
// Null when there's none today, or it couldn't be read.
export interface VisitToday {
  points: number | null;
  streak: number | null;
  visits: number;
  badges: string[];
}

export async function visitToday(memberId: string): Promise<VisitToday | null> {
  const supabase = createAdminClient();
  const date = visitBusinessDate(new Date());
  const { data: v } = await supabase.from("member_visits").select("id, points_awarded, streak").eq("member_id", memberId).eq("business_date", date).maybeSingle();
  if (!v) return null;
  const [badges, count] = await Promise.all([
    supabase.from("member_badges").select("badge").eq("visit_id", v.id),
    supabase.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", memberId),
  ]);
  return {
    points: v.points_awarded === null ? null : Number(v.points_awarded),
    streak: v.streak === null ? null : Number(v.streak),
    visits: count.count ?? 0,
    badges: (badges.data ?? []).map((b) => b.badge as string),
  };
}

// "Undo / Not them" on the register: today's visit taken back, for a
// check-in at the customer screen that wasn't them (a mistyped number,
// say). What it paid (its points and any badges' points) comes off their
// balance as one "Check-in undone" line in their points history (never
// below zero); the badges it earned, and any reward they gave that isn't
// used yet, go; and the visit itself goes, so a right check-in later today
// pays as usual. The visit row is the claim: two registers undoing at once
// take it back once. Null when there's no visit today to undo, or it
// couldn't be read.
export async function undoVisitToday(memberId: string, by: string | null): Promise<{ taken: number; balance: number | null } | null> {
  const supabase = createAdminClient();
  const date = visitBusinessDate(new Date());
  const { data: visit, error } = await supabase.from("member_visits").select("id, points_awarded, business_date").eq("member_id", memberId).eq("business_date", date).maybeSingle();
  if (error || !visit) return null;
  // Read before the visit goes: their link to it is cleared when it does.
  const { data: badges, error: badgeErr } = await supabase.from("member_badges").select("id, badge").eq("visit_id", visit.id);
  if (badgeErr) return null;
  const { data: gone, error: goneErr } = await supabase.from("member_visits").delete().eq("id", visit.id).select("id");
  if (goneErr || !gone?.length) return null;

  const badgeIds = (badges ?? []).map((b) => b.id as string);
  const rewardKinds = [...new Set((badges ?? []).flatMap((b) => badgeFor(b.badge as string)?.reward ?? []))];
  await Promise.all([
    badgeIds.length ? supabase.from("member_badges").delete().in("id", badgeIds) : null,
    rewardKinds.length
      ? supabase.from("member_rewards").delete().eq("member_id", memberId).eq("earned_on", visit.business_date as string).in("kind", rewardKinds).is("redeemed_at", null)
      : null,
  ]);

  const paid = Math.max(0, Number(visit.points_awarded) || 0);
  const { data: m } = await supabase.from("members").select("points").eq("id", memberId).maybeSingle();
  const have = m ? Math.max(0, Number(m.points) || 0) : null;
  const taken = have === null ? 0 : Math.min(paid, have);
  if (taken <= 0) return { taken: 0, balance: have };
  const { data: balance, error: pointsErr } = await supabase.rpc("apply_member_points", {
    p_member: memberId,
    p_delta: -taken,
    p_reason: "visit",
    p_order: null,
    p_booking: null,
    p_note: "Check-in undone",
    p_by: by,
  });
  if (pointsErr) {
    console.error("undoVisitToday: points not taken back", pointsErr.code, pointsErr.message);
    return { taken: 0, balance: have };
  }
  return { taken, balance: Number(balance) };
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

// Who's checked in today (business day), newest first, with their week
// streak.
export async function todaysVisitors(): Promise<{ memberId: string; at: string; streak: number | null }[]> {
  const { data } = await createAdminClient()
    .from("member_visits")
    .select("member_id, checked_in_at, streak")
    .eq("business_date", visitBusinessDate(new Date()))
    .order("checked_in_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((v) => ({ memberId: v.member_id as string, at: v.checked_in_at as string, streak: (v.streak as number | null) ?? null }));
}

// ---------- the member's own account ----------

export interface MemberBadge {
  key: BadgeKey;
  period: string; // "" or, for Birthday Visit, the year
  earnedAt: string;
  points: number;
}

export interface VisitSummary {
  weekStreak: number;
  visits: number; // all-time check-ins
  thisWeek: boolean; // checked in this week yet
  weeks: { monday: string; visited: boolean }[]; // the last 13, oldest first; the last is this week
  badges: MemberBadge[]; // oldest first
}

export const STRIP_WEEKS = 13;

export async function visitSummary(memberId: string, now = new Date()): Promise<VisitSummary> {
  const supabase = createAdminClient();
  const date = visitBusinessDate(now);
  const mondays = recentWeeks(date, STRIP_WEEKS);
  const [streak, recent, count, earned] = await Promise.all([
    supabase.rpc("member_week_streak", { p_member: memberId, p_date: date }),
    supabase.from("member_visits").select("business_date").eq("member_id", memberId).gte("business_date", mondays[0]).lte("business_date", date),
    supabase.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", memberId),
    supabase.from("member_badges").select("badge, period, earned_at, points").eq("member_id", memberId).order("earned_at"),
  ]);
  const visited = new Set((recent.data ?? []).map((v) => weekStart(v.business_date as string)));
  return {
    weekStreak: Math.max(0, Math.round(Number(streak.data) || 0)),
    visits: count.count ?? 0,
    thisWeek: visited.has(weekStart(date)),
    weeks: mondays.map((monday) => ({ monday, visited: visited.has(monday) })),
    badges: (earned.data ?? []).flatMap((r) =>
      badgeFor(r.badge) ? [{ key: r.badge as BadgeKey, period: (r.period as string) ?? "", earnedAt: r.earned_at as string, points: Number(r.points) }] : [],
    ),
  };
}
