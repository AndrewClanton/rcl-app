// Check-in visits and streaks: the rules, in one place. (No server imports:
// the customer screen and the register show the same path.)
//
// A check-in on the customer screen, confirmed by staff, is a visit: once
// per member per business day. Its points grow with their streak, the number
// of open days in a row they've checked in (days the Royale is closed don't
// break it; see member_visit_streak in the database). Some streak lengths
// also earn a reward the register can redeem.
//
// To change the path, change LADDER and REWARD_EVERY below.

export type RewardKind = "popcorn" | "pizza";

export const REWARD_LABEL: Record<RewardKind, string> = {
  popcorn: "Free popcorn",
  pizza: "Free pizza",
};

// From `day` of a streak on, each check-in is worth `points`. A step with a
// reward gives it on exactly that day.
export const LADDER: { day: number; points: number; reward?: RewardKind }[] = [
  { day: 1, points: 10 },
  { day: 3, points: 15 },
  { day: 7, points: 20, reward: "popcorn" },
  { day: 30, points: 25, reward: "pizza" },
];

// After the last step, its reward comes around again every this many days
// (a free pizza at 30, 60, 90...).
export const REWARD_EVERY = 30;

export function visitPoints(streak: number): number {
  let points = LADDER[0].points;
  for (const step of LADDER) if (streak >= step.day) points = step.points;
  return points;
}

export function visitReward(streak: number): RewardKind | null {
  const step = LADDER.find((s) => s.day === streak && s.reward);
  if (step?.reward) return step.reward;
  const last = LADDER[LADDER.length - 1];
  if (last.reward && streak > last.day && (streak - last.day) % REWARD_EVERY === 0) return last.reward;
  return null;
}

export interface NextStep {
  day: number; // the streak day it happens on
  daysLeft: number;
  label: string; // "Free popcorn" or "15 points a visit"
}

// What the streak is building toward next.
export function nextStep(streak: number): NextStep | null {
  const ahead = LADDER.find((s) => s.day > streak);
  if (ahead) return { day: ahead.day, daysLeft: ahead.day - streak, label: ahead.reward ? REWARD_LABEL[ahead.reward] : `${ahead.points} points a visit` };
  const last = LADDER[LADDER.length - 1];
  if (!last.reward) return null;
  const day = last.day + Math.ceil((streak + 1 - last.day) / REWARD_EVERY) * REWARD_EVERY;
  return { day, daysLeft: day - streak, label: `Another ${REWARD_LABEL[last.reward].toLowerCase()}` };
}

// What a check-in did, for the customer screen and the register.
export interface VisitResult {
  earned: number; // points for this check-in (0 if already checked in today)
  streak: number;
  alreadyToday: boolean;
  reward: RewardKind | null; // earned with this check-in
  balance: number; // points after
  visits: number; // all-time check-ins
}
