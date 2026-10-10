// The points history's shared wording and rules, for the Back office's
// member page and the member's own points page. (No server imports: both
// run some of it in the browser.)

import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";

// The most points one staff adjustment can move: a typo guard ($5,000 of
// rewards).
export const MAX_POINTS_CHANGE = 100_000;

// What the old "type a new balance" Save button wrote as the note, before a
// reason was asked for.
export const OLD_ADJUSTMENT_NOTE = "Adjusted by staff";

export function formatPoints(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// A staff adjustment's reason has to say something: a few words, like
// "Birthday party credit". The member sees it on their account.
export function pointsReasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < 8 || r.split(/\s+/).length < 2) return 'Say why in a few words, like "Birthday party credit". The member sees this.';
  if (r.length > 200) return "Keep the reason under 200 characters.";
  return null;
}

// "$3.00 off (60 pts)": what a redemption took off and the points it took.
// The note has the amount first ("$3.00 off order #1234"; older rows say
// "$5 off"); a row without one falls back to the reward rule (20 points a
// dollar). The points are the row's own, so a $5 off from before prorating
// still shows its 100.
export function rewardOff(note: string | null, delta: number): string {
  const m = note?.match(/^\$?(\d+(?:\.\d+)?) off/);
  const pts = Math.abs(delta);
  const dollars = m ? Number(m[1]) : (pts / POINTS_PER_REWARD) * REWARD_VALUE;
  return `$${dollars.toFixed(2)} off (${formatPoints(pts)} pts)`;
}

// A reward from the catalog (Spend points): its note is "Reward: Personal
// popcorn (order #1234)" -> "Personal popcorn". Null for the $5 off.
export function rewardName(note: string | null): string | null {
  const m = note?.match(/^Reward: (.+?)(?: \(order #\d+\))?$/);
  return m ? m[1] : null;
}

// A staff-written note, unless it's the old placeholder.
export function adjustmentNote(note: string | null): string | null {
  const n = note?.trim();
  return n && n !== OLD_ADJUSTMENT_NOTE ? n : null;
}
