// "Most regular regulars": how steadily someone comes in, from the days they
// came. No server imports: the staff page and scripts/check-fortis-backfill.mjs
// both use it.
//
// A visit day is a business date (4 a.m. to 4 a.m. Central). Weeks run
// Monday to Sunday, the same as the check-in week streak (lib/visits.ts): a
// week the Royale was closed (nobody's visit in it) doesn't count and
// doesn't break a run, and the week in progress doesn't break one either,
// since it isn't over yet.

import { shiftDay, weekStart } from "@/lib/visits";

export interface Regularity {
  days: number; // distinct visit days
  longestRun: number; // most weeks in a row with a visit
  currentRun: number; // weeks in a row, up to the week of asOf
  first: string | null;
  last: string | null;
}

// dates: one person's visit days (any order, repeats fine). openWeeks: the
// Mondays of weeks anybody came in. asOf: the day the current run is
// counted to.
export function regularity(dates: Iterable<string>, openWeeks: Set<string>, asOf: string): Regularity {
  const days = [...new Set(dates)].filter((d) => d <= asOf).sort();
  if (!days.length) return { days: 0, longestRun: 0, currentRun: 0, first: null, last: null };
  const weeks = new Set(days.map(weekStart));
  const thisWeek = weekStart(asOf);
  let run = 0;
  let longest = 0;
  for (let wk = weekStart(days[0]); wk <= thisWeek; wk = shiftDay(wk, 7)) {
    if (weeks.has(wk)) {
      run++;
      longest = Math.max(longest, run);
    } else if (wk !== thisWeek && openWeeks.has(wk)) {
      run = 0;
    }
  }
  return { days: days.length, longestRun: longest, currentRun: run, first: days[0], last: days[days.length - 1] };
}

export type RegularSort = "days" | "longest" | "current";

export function compareRegulars(sort: RegularSort) {
  const order: (keyof Regularity)[] = sort === "days" ? ["days", "longestRun", "currentRun"] : sort === "longest" ? ["longestRun", "days", "currentRun"] : ["currentRun", "longestRun", "days"];
  return (a: Regularity, b: Regularity) => {
    for (const k of order) {
      const d = (b[k] as number) - (a[k] as number);
      if (d) return d;
    }
    return (b.last ?? "").localeCompare(a.last ?? "");
  };
}
