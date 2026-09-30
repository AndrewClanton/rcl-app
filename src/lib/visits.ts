// Check-ins, the week streak and badges: the rules, in one place. (No
// server imports: the customer screen, the register and the account pages
// all use them.)
//
// A check-in on the customer screen, confirmed by staff (or a member card or
// online ticket scanned at the door), is a visit: once per member per
// business day (4 a.m. to 4 a.m. Central). Every visit pays VISIT_POINTS.
// Badges (BADGES below) pay once each, when earned: the first visit, an
// early or a late check-in, 4/13/26/52 weeks in a row, the 10th/50th/100th
// visit, and a visit in their birthday week (that one once a year). The 13-
// and 26-week badges also give a free popcorn and a free pizza, which the
// register redeems.
//
// The week streak is how many Monday-to-Sunday weeks in a row (by business
// date) they've checked in at least once. A week the Royale was closed (no
// check-ins by anyone, no sales) doesn't break it, and neither does the
// current week before they've come in: it isn't over yet. The database's
// member_week_streak does the counting; weekStreak() below is the same
// rule, for the checks in scripts/check-visit-badges.mjs.
//
// The database (award_member_visit) pays a badge at most once: badges are
// unique per member, badge and period. badgesFor() lists every badge a visit
// qualifies for, so a badge a visit missed (its points didn't save, say) is
// picked up at the next one.
//
// To change the points or the badges, change VISIT_POINTS and BADGES.

export type RewardKind = "popcorn" | "pizza";

export const REWARD_LABEL: Record<RewardKind, string> = {
  popcorn: "Free popcorn",
  pizza: "Free pizza",
};

export const REWARD_EMOJI: Record<RewardKind, string> = { popcorn: "🍿", pizza: "🍕" };

// Every confirmed check-in, once per business day.
export const VISIT_POINTS = 5;

const TZ = "America/Chicago";
// The business day starts at 4 a.m. Central (like lib/ops/time.ts).
const DAY_STARTS = 4 * 60;
// Early Riser: 4:00 to 8:29 AM. Night Owl: 11:00 PM to 3:59 AM (the small
// hours belong to the business day before).
export const EARLY_RISER_BEFORE = 8 * 60 + 30;
export const NIGHT_OWL_FROM = 23 * 60;

export type BadgeKey =
  | "welcome"
  | "early_riser"
  | "night_owl"
  | "birthday"
  | "weeks_4"
  | "weeks_13"
  | "weeks_26"
  | "weeks_52"
  | "visits_10"
  | "visits_50"
  | "visits_100";

export interface Badge {
  key: BadgeKey;
  emoji: string;
  label: string;
  points: number;
  reward?: RewardKind;
  // How to earn it, for the account's badge cabinet.
  how: string;
  // The tablet's banner when it's earned; {name} is their first name.
  cheer: string;
  // Earned by this many check-ins, all time.
  visits?: number;
  // Earned by this many weeks in a row.
  weeks?: number;
  // Birthday Visit: once a year, not once ever.
  yearly?: boolean;
}

export const BADGES: Badge[] = [
  { key: "welcome", emoji: "🎟️", label: "Welcome", points: 50, visits: 1, how: "Your first check-in.", cheer: "{name}, your first check-in!" },
  { key: "early_riser", emoji: "🌅", label: "Early Riser", points: 25, how: "Check in before 8:30 AM.", cheer: "{name}, you're an Early Riser!" },
  { key: "night_owl", emoji: "🦉", label: "Night Owl", points: 25, how: "Check in at 11 PM or later.", cheer: "{name}, you're a Night Owl!" },
  { key: "birthday", emoji: "🎂", label: "Birthday Visit", points: 50, yearly: true, how: "Check in during your birthday week. Every year.", cheer: "Happy birthday, {name}!" },
  { key: "weeks_4", emoji: "📅", label: "4 Weeks", points: 25, weeks: 4, how: "Check in 4 weeks in a row.", cheer: "{name}, 4 weeks in a row!" },
  { key: "weeks_13", emoji: "🍿", label: "A Season", points: 75, reward: "popcorn", weeks: 13, how: "13 weeks in a row. Comes with a free popcorn.", cheer: "{name}, 13 weeks in a row!" },
  { key: "weeks_26", emoji: "🍕", label: "Half a Year", points: 150, reward: "pizza", weeks: 26, how: "26 weeks in a row. Comes with a free pizza.", cheer: "{name}, 26 weeks in a row!" },
  { key: "weeks_52", emoji: "🏆", label: "Week for a Year", points: 500, weeks: 52, how: "Every week for a year: 52 in a row.", cheer: "{name}, every week for a year!" },
  { key: "visits_10", emoji: "🔟", label: "Regular", points: 25, visits: 10, how: "Your 10th check-in.", cheer: "{name}, you're a Regular!" },
  { key: "visits_50", emoji: "🛋️", label: "Fixture", points: 100, visits: 50, how: "Your 50th check-in.", cheer: "{name}, you're a Fixture!" },
  { key: "visits_100", emoji: "👑", label: "Legend", points: 250, visits: 100, how: "Your 100th check-in.", cheer: "{name}, you're a Legend!" },
];

const BY_KEY = new Map<string, Badge>(BADGES.map((b) => [b.key, b]));

export function badgeFor(key: unknown): Badge | null {
  return typeof key === "string" ? (BY_KEY.get(key) ?? null) : null;
}

// ---------- dates and times ----------

const pad = (n: number) => String(n).padStart(2, "0");

// A "YYYY-MM-DD" date `days` before/after another.
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The Monday of a date's Monday-to-Sunday week.
export function weekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDay(date, -((dow + 6) % 7));
}

let clockFormat: Intl.DateTimeFormat | null = null;

// The wall clock in Joplin at an instant: the date and minutes after
// midnight, CDT or CST as it was then.
export function centralClock(at: Date): { date: string; minutes: number } {
  clockFormat ??= new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(clockFormat.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

// The business day a check-in at `at` counts for: before 4 a.m. on the
// clock, it's still the day before. (By the wall clock, so the nights the
// clocks change are right too.)
export function visitBusinessDate(at: Date): string {
  const c = centralClock(at);
  return c.minutes < DAY_STARTS ? shiftDay(c.date, -1) : c.date;
}

export function isEarlyRiser(at: Date): boolean {
  const m = centralClock(at).minutes;
  return m >= DAY_STARTS && m < EARLY_RISER_BEFORE;
}

export function isNightOwl(at: Date): boolean {
  const m = centralClock(at).minutes;
  return m >= NIGHT_OWL_FROM || m < DAY_STARTS;
}

// ---------- birthdays ----------
// Stored as a date in BIRTHDAY_YEAR (a leap year, so Feb 29 fits): only the
// month and day mean anything.

export const BIRTHDAY_YEAR = 2000;

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function birthdayMonthDay(value: string | null | undefined): { month: number; day: number } | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return birthdayValue(month, day) ? { month, day } : null;
}

// A month and day as the stored date, or null if there's no such day.
export function birthdayValue(month: number, day: number): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return null;
  const value = `${BIRTHDAY_YEAR}-${pad(month)}-${pad(day)}`;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
}

// A form's "12-30" (month-day, from BirthdayPicker) as the stored date:
// null for "" (no birthday), undefined if it isn't a whole, real day.
export function birthdayFromInput(input: string): string | null | undefined {
  const t = input.trim();
  if (!t) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(t);
  return (m && birthdayValue(Number(m[1]), Number(m[2]))) || undefined;
}

// The stored date as a form's "12-30", or "".
export function birthdayToInput(value: string | null | undefined): string {
  const md = birthdayMonthDay(value);
  return md ? `${md.month}-${md.day}` : "";
}

// "December 30"
export function birthdayLabel(value: string | null | undefined): string | null {
  const md = birthdayMonthDay(value);
  return md ? `${MONTH_NAMES[md.month - 1]} ${md.day}` : null;
}

function isLeap(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Which birthday's week (Monday to Sunday) a business date is in, as the
// year of that birthday, or null if it isn't in one. A late-December
// birthday's week can run into January: a visit on Jan 2 is then for the
// birthday of the year before. Feb 29 is Feb 28 in other years.
export function birthdayWeekYear(birthday: string | null | undefined, date: string): number | null {
  const md = birthdayMonthDay(birthday);
  if (!md) return null;
  const week = weekStart(date);
  const y = Number(date.slice(0, 4));
  for (const year of [y - 1, y, y + 1]) {
    const day = md.month === 2 && md.day === 29 && !isLeap(year) ? 28 : md.day;
    if (weekStart(`${year}-${pad(md.month)}-${pad(day)}`) === week) return year;
  }
  return null;
}

// ---------- the week streak ----------

// The week streak on `date`: `visits` are the business dates they checked
// in, and isOpenWeek says whether the Royale was open in a week (by its
// Monday). The same rule as member_week_streak in the database.
export function weekStreak(date: string, visits: Iterable<string>, isOpenWeek: (monday: string) => boolean): number {
  const weeks = new Set<string>();
  for (const d of visits) if (d <= date) weeks.add(weekStart(d));
  if (!weeks.size) return 0;
  const first = [...weeks].sort()[0];
  const thisWeek = weekStart(date);
  let streak = 0;
  for (let wk = thisWeek; wk >= first; wk = shiftDay(wk, -7)) {
    if (weeks.has(wk)) streak++;
    else if (wk !== thisWeek && isOpenWeek(wk)) break;
  }
  return streak;
}

// The Mondays of the last `n` weeks, oldest first, ending with this week.
export function recentWeeks(date: string, n: number): string[] {
  const now = weekStart(date);
  return Array.from({ length: n }, (_, i) => shiftDay(now, -7 * (n - 1 - i)));
}

// The next week-streak badge and how many more weeks to it.
export function nextWeekBadge(streak: number): { badge: Badge; weeksLeft: number } | null {
  const b = BADGES.find((x) => x.weeks && x.weeks > streak);
  return b?.weeks ? { badge: b, weeksLeft: b.weeks - streak } : null;
}

// ---------- which badges a visit earns ----------

export interface VisitFacts {
  at: Date; // when they checked in
  visitNumber: number; // their check-ins so far, this one included
  weekStreak: number; // weeks in a row, this one included
  birthday: string | null; // members.birthday
}

// A badge and its period: "" for a once-ever badge, the birthday's year for
// Birthday Visit.
export interface BadgeClaim {
  key: BadgeKey;
  period: string;
}

// Every badge this visit qualifies for. Ones they already have are skipped
// by the database, so this doesn't need to know.
export function badgesFor(f: VisitFacts): BadgeClaim[] {
  const out: BadgeClaim[] = [];
  for (const b of BADGES) {
    let period: string | null = null;
    if (b.visits) period = f.visitNumber >= b.visits ? "" : null;
    else if (b.weeks) period = f.weekStreak >= b.weeks ? "" : null;
    else if (b.key === "early_riser") period = isEarlyRiser(f.at) ? "" : null;
    else if (b.key === "night_owl") period = isNightOwl(f.at) ? "" : null;
    else if (b.key === "birthday") {
      const year = birthdayWeekYear(f.birthday, visitBusinessDate(f.at));
      period = year === null ? null : String(year);
    }
    if (period !== null) out.push({ key: b.key, period });
  }
  return out;
}

// ---------- what a check-in did ----------

// A badge as the register and the customer screen see it.
export interface EarnedBadge {
  key: BadgeKey;
  label: string;
  emoji: string;
  points: number;
  reward: RewardKind | null;
}

export function earnedBadge(b: Badge): EarnedBadge {
  return { key: b.key, label: b.label, emoji: b.emoji, points: b.points, reward: b.reward ?? null };
}

// What a check-in did, for the customer screen and the register.
export interface VisitResult {
  earned: number; // every point this check-in paid, badges included (0 if already checked in today)
  visitPoints: number; // the check-in's own points (VISIT_POINTS, or 0)
  badges: EarnedBadge[]; // new with this check-in
  rewards: RewardKind[]; // free popcorn/pizza that came with them
  weekStreak: number;
  alreadyToday: boolean;
  balance: number; // points after
  visits: number; // all-time check-ins
}

// "🦉 Night Owl (+25), 🎟️ Welcome (+50)"
export function badgeList(badges: Pick<EarnedBadge, "emoji" | "label" | "points">[]): string {
  return badges.map((b) => `${b.emoji} ${b.label} (+${b.points})`).join(", ");
}

// The banner for a new badge on the customer screen: "🦉" "Maya, you're a
// Night Owl!" "+25 points".
export function badgeCheer(b: Badge, firstName: string): { emoji: string; title: string; detail: string } {
  const title = b.cheer.replace("{name}", firstName);
  const detail = b.reward ? `+${b.points} points and a ${REWARD_LABEL[b.reward].toLowerCase()}! Just ask your bartender.` : `+${b.points} points`;
  return { emoji: b.emoji, title, detail };
}
