// The loyalty rule, in one place. The register, the points history, member
// pages and marketing copy all read it from here.
export const POINTS_PER_REWARD = 100;
export const REWARD_VALUE = 5;
export const LOYALTY_SUMMARY = `1 point per $1 spent · ${POINTS_PER_REWARD} points = $${REWARD_VALUE} off`;

// The points a reward takes: only what it took off, at 20 points a dollar,
// so $3.00 off a $3 order takes 60 and the other 40 stay. Never more than
// POINTS_PER_REWARD, never less than 1; 0 when nothing came off.
export function rewardPointsFor(discount: number): number {
  const d = Number(discount);
  if (!(d > 0)) return 0;
  return Math.min(POINTS_PER_REWARD, Math.max(1, Math.round((d / REWARD_VALUE) * POINTS_PER_REWARD)));
}

// "Points reward (60 pts)": the discount line on the register, the customer
// screen and the printed receipt.
export function rewardLabel(discount: number): string {
  const p = rewardPointsFor(discount);
  return p ? `Points reward (${p} pts)` : "Points reward";
}
