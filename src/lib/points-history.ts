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

// "$5 off": what a redemption took off. The register writes the amount
// first in the note ("5.00 off order #1234"); older rows fall back to the
// reward rule.
export function rewardOff(note: string | null, delta: number): string {
  const m = note?.match(/^\$?(\d+(?:\.\d+)?) off/);
  const dollars = m ? Number(m[1]) : (Math.abs(delta) / POINTS_PER_REWARD) * REWARD_VALUE;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)} off`;
}

// A staff-written note, unless it's the old placeholder.
export function adjustmentNote(note: string | null): string | null {
  const n = note?.trim();
  return n && n !== OLD_ADJUSTMENT_NOTE ? n : null;
}
