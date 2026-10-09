// How badges are earned, as data (badge_defs.rule_type and rule_params),
// replacing the hard-coded checks in lib/visits.ts badgesFor. Check-in
// rules run at every paid check-in (lib/visits-server.ts); `manual` badges
// are given in Back office; `event` badges never match a check-in here:
// lib/badges/events.ts awards them from attendance (lib/badges/attendance.ts).
//
// The eleven badges from before are Series 1 defs with these rules, and
// FALLBACK_DEFS below is the same list, used if the catalog can't be read,
// so a check-in pays exactly what it did before either way.

import { BADGES, birthdayWeekYear, centralClock, visitBusinessDate, type RewardKind, type VisitFacts } from "@/lib/visits";

export const RULE_TYPES = ["first_visit", "visit_count", "week_streak", "checkin_time", "birthday_week", "manual", "event"] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_INFO: Record<RuleType, { label: string; about: string }> = {
  first_visit: { label: "First check-in", about: "Their very first check-in." },
  visit_count: { label: "Check-ins", about: "Their Nth check-in, all time." },
  week_streak: { label: "Weeks in a row", about: "N Monday-to-Sunday weeks in a row." },
  checkin_time: { label: "Time of day", about: "Checked in between two times (Central)." },
  birthday_week: { label: "Birthday week", about: "Checked in during their birthday week. Every year." },
  manual: { label: "Awarded by hand", about: "Staff give it in Back office -> Badges." },
  event: { label: "Came to an event", about: "A showing, a house event, or a series (\"came to 5 Trivia nights\"). Awarded on its own when they come." },
};

export interface RuleParams {
  count?: number; // visit_count
  weeks?: number; // week_streak
  from?: number; // checkin_time: minutes after midnight, Central
  before?: number; // checkin_time: wraps past midnight when before < from
  kind?: "screening" | "house_event" | "series"; // event
  match?: string; // event: what it matches (a series name, a showing id)
  times?: number; // event: how many
}

export interface RuleDef {
  key: string;
  name: string;
  ruleType: RuleType;
  params: RuleParams;
  period: "once" | "yearly";
  points: number;
  reward: RewardKind | null;
  cheer: string | null;
  setNumber: number;
}

// A badge and its period: "" for once ever, the birthday's year for a yearly one.
export interface Claim {
  key: string;
  period: string;
}

function inWindow(minutes: number, from: number, before: number): boolean {
  return from < before ? minutes >= from && minutes < before : minutes >= from || minutes < before;
}

// The period a visit earns a badge for, or null if it doesn't.
export function ruleMatches(d: RuleDef, f: VisitFacts): string | null {
  const p = d.params ?? {};
  switch (d.ruleType) {
    case "first_visit":
      return f.visitNumber >= 1 ? "" : null;
    case "visit_count":
      return p.count && f.visitNumber >= p.count ? "" : null;
    case "week_streak":
      return p.weeks && f.weekStreak >= p.weeks ? "" : null;
    case "checkin_time": {
      if (typeof p.from !== "number" || typeof p.before !== "number") return null;
      return inWindow(centralClock(f.at).minutes, p.from, p.before) ? "" : null;
    }
    case "birthday_week": {
      const year = birthdayWeekYear(f.birthday, visitBusinessDate(f.at));
      return year === null ? null : String(year);
    }
    default:
      return null; // manual and event badges never come from a check-in
  }
}

// Every badge this visit qualifies for, in set order. Ones they already
// have are skipped by the database.
export function claimsFor(defs: RuleDef[], f: VisitFacts): Claim[] {
  const out: Claim[] = [];
  for (const d of [...defs].sort((a, b) => a.setNumber - b.setNumber)) {
    const period = ruleMatches(d, f);
    if (period !== null) out.push({ key: d.key, period });
  }
  return out;
}

// The time of day as the back of a card says it: "11:42 PM".
export function clockLabel(at: Date): string {
  return at.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
}

// The stats a copy is minted with, fitting its rule.
export function statsFor(d: Pick<RuleDef, "ruleType">, f: VisitFacts | null, period: string, note?: string | null): Record<string, string | number> {
  if (d.ruleType === "manual") return note ? { for: note.slice(0, 40) } : {};
  if (!f) return {};
  const s: Record<string, string | number> = { visits: f.visitNumber };
  if (f.weekStreak > 0) s.weeks = f.weekStreak;
  if (d.ruleType === "checkin_time") s.time = clockLabel(f.at);
  if (d.ruleType === "birthday_week" && /^\d{4}$/.test(period)) s.year = Number(period);
  return s;
}

// ---------- Series 1: the eleven badges from before ----------

const EARLY_RISER = { from: 4 * 60, before: 8 * 60 + 30 };
const NIGHT_OWL = { from: 23 * 60, before: 4 * 60 };

// The rule each of the eleven had in code (lib/visits.ts BADGES).
export const SERIES1_RULES: Record<string, { ruleType: RuleType; params: RuleParams; period: "once" | "yearly" }> = Object.fromEntries(
  BADGES.map((b) => {
    if (b.key === "welcome") return [b.key, { ruleType: "first_visit", params: {}, period: "once" }];
    if (b.visits) return [b.key, { ruleType: "visit_count", params: { count: b.visits }, period: "once" }];
    if (b.weeks) return [b.key, { ruleType: "week_streak", params: { weeks: b.weeks }, period: "once" }];
    if (b.key === "early_riser") return [b.key, { ruleType: "checkin_time", params: EARLY_RISER, period: "once" }];
    if (b.key === "night_owl") return [b.key, { ruleType: "checkin_time", params: NIGHT_OWL, period: "once" }];
    return [b.key, { ruleType: "birthday_week", params: {}, period: "yearly" }];
  }),
);

export const FALLBACK_DEFS: RuleDef[] = BADGES.map((b, i) => ({
  key: b.key,
  name: b.label,
  ...SERIES1_RULES[b.key],
  points: b.points,
  reward: b.reward ?? null,
  cheer: b.cheer,
  setNumber: i + 1,
}));
