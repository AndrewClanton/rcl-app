// Who an email goes to, as plain rules over one member's facts
// (member_email_facts), plus the frequency caps. No server code: the
// composer shows the same words in the browser, and the check script
// (scripts/check-email-marketing.mjs) tests these directly.
import {
  SENT_STATUSES,
  type Audience,
  type Automation,
  type CampaignKind,
  type Category,
  type ConsentSource,
  type Exclusion,
  type MemberFacts,
  type PrefCategory,
  type Rule,
  type RuleKey,
  type SendRecord,
} from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// "YYYY-MM-DD" plus n days.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface RuleContext {
  now: Date;
  today: string; // the business date (4 a.m. to 4 a.m. Central)
  // Members matching each genre rule, found by the server beforehand
  // (member_genre_days), keyed by genreKey().
  genreMembers?: Map<string, Set<string>>;
  // Former unlimited members with nothing paying for their Insiders+ now
  // (lib/legacy-plus.ts legacyNeedsSetup), found by the server beforehand.
  legacyNeedsSetup?: Set<string>;
  // Of those, the ones the old system still charges (legacy_billing_payers,
  // 20261002040000): resolveAudience leaves them out as "paid_old_system".
  paidOldSystem?: Set<string>;
}

export const genreKey = (r: { v: string; within: number; min: number }) => `${r.v.toLowerCase()}|${r.within}|${r.min}`;

function within(iso: string | null, days: number, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > now.getTime() - days * DAY && t <= now.getTime() + HOUR;
}

function daysSince(dates: string[], days: number, today: string): number {
  const from = addDays(today, -days);
  return dates.filter((d) => d > from && d <= today).length;
}

// Month and day of a birthday falls in [today, today + days).
export function birthdayWithin(birthday: string | null, today: string, days: number): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return false;
  const md = birthday.slice(5);
  for (let i = 0; i < Math.max(1, days); i++) {
    const d = addDays(today, i);
    if (d.slice(5) === md) return true;
    // Feb 29 birthdays count on Feb 28 in other years.
    if (md === "02-29" && d.slice(5) === "02-28" && addDays(d, 1).slice(5) === "03-01") return true;
  }
  return false;
}

// The latest thing that shows this person wants to hear from us.
export function lastEngagement(f: Pick<MemberFacts, "lastClickAt" | "lastVisitOn" | "lastEngagedAt">): number {
  const visit = f.lastVisitOn ? Date.parse(`${f.lastVisitOn}T12:00:00Z`) : NaN;
  return Math.max(Date.parse(f.lastClickAt ?? "") || 0, visit || 0, Date.parse(f.lastEngagedAt ?? "") || 0);
}

// "Still want these?" is due:
//  - cold import: came over from the old site, got the invite plus 4
//    marketing emails, and has done nothing since;
//  - anyone: 10+ marketing emails since they last clicked, came in or
//    changed their settings, and that was over 90 days ago.
export function sunsetDue(f: MemberFacts, now: Date): boolean {
  if (f.engagement !== "active") return false;
  const engaged = lastEngagement(f);
  if (f.consentSource === "old_site_import" && f.inviteDelivered && f.deliveredSinceEngaged >= 5 && engaged === 0) return true;
  return f.deliveredSinceEngaged >= 10 && (engaged === 0 || engaged < now.getTime() - 90 * DAY);
}

export function matchesRule(f: MemberFacts, rule: Rule, ctx: RuleContext): boolean {
  const { now, today } = ctx;
  switch (rule.r) {
    case "all":
      return true;
    case "tier":
      return rule.v === "Insiders+" ? f.tier === "Insiders+" : f.tier !== "Insiders+";
    case "consent":
      return rule.v.includes(f.consentSource);
    case "legacy_plus":
      return f.legacyPlus;
    case "joined_within":
      return !f.imported && within(f.createdAt, rule.days, now);
    case "birthday_within":
      return birthdayWithin(f.birthday, today, rule.days);
    case "visit_days":
      return daysSince(f.visitDays, rule.within, today) >= rule.min;
    case "lapsed":
      return !!f.lastVisitOn && f.lastVisitOn <= addDays(today, -rule.days);
    case "never_visited":
      return !f.firstVisitOn;
    case "archive_fans":
      return daysSince(f.archiveDays, rule.within, today) >= rule.min;
    case "genre":
      return ctx.genreMembers?.get(genreKey(rule))?.has(f.memberId) ?? false;
    case "bar": {
      const key = rule.v === "alcohol" ? "a" : rule.v === "coffee" ? "c" : "f";
      return f.orders.filter((o) => o[key] && within(o.d, rule.within, now)).length >= rule.min;
    }
    case "paid_tickets":
      return f.tickets.filter((t) => t.p > 0 && within(t.d, rule.within, now)).reduce((n, t) => n + t.q, 0) >= rule.min;
    case "clicked_within":
      return within(f.lastClickAt, rule.days, now);
    case "clicked_campaign":
      return f.sends.some((s) => s.c === rule.id && s.ck);
    case "received_campaign":
      return f.sends.some((s) => s.c === rule.id && SENT_STATUSES.has(s.s));
    case "engaged": {
      const at = lastEngagement(f);
      return at > now.getTime() - rule.days * DAY;
    }
    case "has_login":
      return f.hasLogin === rule.v;
    case "has_phone":
      return f.hasPhone === rule.v;
    case "legacy_needs_setup":
      return ctx.legacyNeedsSetup?.has(f.memberId) ?? false;
    case "old_site":
      return f.fromOldSite === rule.v;
    case "sunset_due":
      return sunsetDue(f, now);
  }
}

export function matchesAudience(f: MemberFacts, a: Audience, ctx: RuleContext): boolean {
  const include = a.include?.length ? a.include : [{ r: "all" } as Rule];
  return include.every((r) => matchesRule(f, r, ctx)) && !(a.exclude ?? []).some((r) => matchesRule(f, r, ctx));
}

// ---------- the hard filters ----------
export interface CampaignShape {
  id: string;
  kind: CampaignKind;
  category: Category;
  automation: Automation | null;
  alert?: string | null;
}

// Everything that rules someone out whatever the audience says. Null:
// they can have it.
export function hardFilter(f: MemberFacts, c: CampaignShape, now: Date): Exclusion | null {
  if (!f.emailOptIn) return "opted_out";
  if (f.suppressed) return "suppressed";
  if (c.category !== "account" && !f.prefs[c.category as PrefCategory]) return "pref_off";
  if (f.pausedUntil && Date.parse(f.pausedUntil) > now.getTime()) return "paused";
  if (f.engagement === "dormant" && c.kind !== "reconfirm" && c.automation !== "reconfirm") return "dormant";
  if (!looksDeliverable(f.email)) return "bad_address";
  return null;
}

// Good enough to hand to Resend: one @, a dot in the domain, no spaces.
// (Resend's batch fails whole if any address is malformed.)
export function looksDeliverable(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim();
  return e.length <= 254 && /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[a-z]{2,}$/i.test(e) && !e.includes("..");
}

// ---------- the caps ----------
// Hard limits, per person, across every marketing email (the 'account'
// category -- the invite and "Still want these?" -- doesn't count and isn't
// held back):
//   - never two within 20 hours;
//   - at most 2 in any 7 days (the lineup plus one extra);
//   - at most 1 extra (anything but the lineup) in any 7 days; welcome
//     emails skip this one in a member's first 14 days;
//   - at most 8 in any 30 days;
//   - tonight alerts at most 2 in 30 days, offers 1 in 30, the Insiders+
//     upsell 1 in 60.
// `at` is when this email would arrive, so a send already scheduled for
// later today counts too. A one-off email's own row doesn't count against
// itself; an automation's earlier sends do (last month's upsell, say), so
// the sender leaves out the very row it's checking.
export const CAP = {
  gapHours: 20,
  week: { days: 7, max: 2 },
  extraWeek: { days: 7, max: 1 },
  month: { days: 30, max: 8 },
  tonight: { days: 30, max: 2 },
  offer: { days: 30, max: 1 },
  upsell: { days: 60, max: 1 },
  welcomeGraceDays: 14,
} as const;

// Would one more at `at` keep every `windowDays`-long stretch at `max` or
// fewer? (With it added, no max+1 of them fall inside one window.)
export function fitsWindow(times: number[], at: number, windowDays: number, max: number): boolean {
  const w = windowDays * DAY;
  const near = times.filter((t) => Math.abs(t - at) < w);
  const all = [...near, at].sort((a, b) => a - b);
  for (let i = 0; i + max < all.length; i++) if (all[i + max] - all[i] < w) return false;
  return true;
}

function isWelcome(a: Automation | null) {
  return a === "welcome_1" || a === "welcome_2" || a === "welcome_3";
}

export function capCheck(sends: SendRecord[], c: CampaignShape, at: Date, member: { createdAt: string; imported: boolean }): Exclusion | null {
  if (c.category === "account") return null;
  const t = at.getTime();
  const marketing = sends.filter((s) => (c.kind === "automation" || !!c.automation || s.c !== c.id) && SENT_STATUSES.has(s.s) && s.g !== "account");
  const times = (list: SendRecord[]) => list.map((s) => Date.parse(s.t)).filter(Number.isFinite);

  if (times(marketing).some((x) => Math.abs(x - t) < CAP.gapHours * HOUR)) return "cap_day";
  if (!fitsWindow(times(marketing), t, CAP.week.days, CAP.week.max)) return "cap_week";
  if (c.kind !== "lineup") {
    const graced = isWelcome(c.automation) && !member.imported && t - Date.parse(member.createdAt) < CAP.welcomeGraceDays * DAY;
    if (!graced && !fitsWindow(times(marketing.filter((s) => s.k !== "lineup")), t, CAP.extraWeek.days, CAP.extraWeek.max)) return "cap_extra";
  }
  if (!fitsWindow(times(marketing), t, CAP.month.days, CAP.month.max)) return "cap_month";
  if (c.kind === "alert" && c.alert === "tonight") {
    if (!fitsWindow(times(marketing.filter((s) => s.k === "alert" && s.x === "tonight")), t, CAP.tonight.days, CAP.tonight.max)) return "cap_kind";
  }
  if (c.automation === "plus_upsell") {
    if (!fitsWindow(times(marketing.filter((s) => s.a === "plus_upsell")), t, CAP.upsell.days, CAP.upsell.max)) return "cap_kind";
  } else if (c.kind === "offer") {
    if (!fitsWindow(times(marketing.filter((s) => s.k === "offer" || s.a === "plus_upsell")), t, CAP.offer.days, CAP.offer.max)) return "cap_kind";
  }
  return null;
}

// ---------- money ----------
// The share of an order that was paid in money: trivia vouchers are prizes,
// not money coming in, and a tip isn't a sale. 1 for a fully paid order, 0
// for one vouchers covered. (member_email_facts does the same in SQL.)
export function paidShare(o: { total: number | string | null; tip?: number | string | null; payment_voucher_amount?: number | string | null }): number {
  const goods = (Number(o.total) || 0) - (Number(o.tip) || 0);
  if (!(goods > 0)) return 0;
  const paid = goods - (Number(o.payment_voucher_amount) || 0);
  return Math.max(0, Math.min(1, paid / goods));
}

// ---------- warm-up order ----------
// "trust": the people most likely to want this first. New sign-ups and
// kiosk/claim people, then Indy "yes" people who paid on the old site, then
// the other Indy "yes" people, then old-site paying members, likely-real
// imports, and the manually reviewed imports last.
export function trustRank(f: Pick<MemberFacts, "consentSource" | "legacyPlus" | "importGroup">): number {
  switch (f.consentSource) {
    case "join_form":
    case "checkout":
      return 0;
    case "kiosk":
    case "account":
    case "staff":
      return 1;
    case "claim":
      return 2;
    case "indy_yes":
      return f.legacyPlus ? 3 : 4;
    case "old_site_import":
      if (f.legacyPlus || f.importGroup === "paying") return 5;
      if (f.importGroup === "review") return 8;
      return 6;
    case "unknown":
      return 7;
    case "indy_no":
      return 9;
  }
}

// ---------- in plain words ----------
export const RULE_CHOICES: { key: RuleKey; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "tier", label: "Membership" },
  { key: "consent", label: "Where their yes came from" },
  { key: "legacy_plus", label: "Paid on the old website" },
  { key: "joined_within", label: "Joined recently (new system)" },
  { key: "birthday_within", label: "Birthday coming up" },
  { key: "visit_days", label: "Came in often" },
  { key: "lapsed", label: "Came in before, not lately" },
  { key: "never_visited", label: "Never come in (new system)" },
  { key: "archive_fans", label: "Classic-film fans" },
  { key: "genre", label: "Genre fans" },
  { key: "bar", label: "Bar, coffee or kitchen regulars" },
  { key: "paid_tickets", label: "Bought paid tickets" },
  { key: "clicked_within", label: "Clicked an email lately" },
  { key: "clicked_campaign", label: "Clicked a particular email" },
  { key: "received_campaign", label: "Got a particular email" },
  { key: "engaged", label: "Engaged (clicked or came in)" },
  { key: "has_login", label: "Has a website login" },
  { key: "has_phone", label: "Has a phone number on file" },
  { key: "legacy_needs_setup", label: "Former unlimited, nothing paying now" },
  { key: "old_site", label: "Had an old-website account" },
  { key: "sunset_due", label: "Due a \"Still want these?\"" },
];

export function defaultRule(key: RuleKey): Rule {
  switch (key) {
    case "all":
      return { r: "all" };
    case "tier":
      return { r: "tier", v: "Insiders" };
    case "consent":
      return { r: "consent", v: ["indy_yes"] };
    case "legacy_plus":
      return { r: "legacy_plus" };
    case "joined_within":
      return { r: "joined_within", days: 30 };
    case "birthday_within":
      return { r: "birthday_within", days: 7 };
    case "visit_days":
      return { r: "visit_days", within: 30, min: 3 };
    case "lapsed":
      return { r: "lapsed", days: 45 };
    case "never_visited":
      return { r: "never_visited" };
    case "archive_fans":
      return { r: "archive_fans", within: 90, min: 2 };
    case "genre":
      return { r: "genre", v: "Horror", within: 90, min: 2 };
    case "bar":
      return { r: "bar", v: "coffee", within: 30, min: 2 };
    case "paid_tickets":
      return { r: "paid_tickets", within: 30, min: 2 };
    case "clicked_within":
      return { r: "clicked_within", days: 60 };
    case "clicked_campaign":
      return { r: "clicked_campaign", id: "" };
    case "received_campaign":
      return { r: "received_campaign", id: "" };
    case "engaged":
      return { r: "engaged", days: 60 };
    case "has_login":
      return { r: "has_login", v: false };
    case "has_phone":
      return { r: "has_phone", v: true };
    case "legacy_needs_setup":
      return { r: "legacy_needs_setup" };
    case "old_site":
      return { r: "old_site", v: false };
    case "sunset_due":
      return { r: "sunset_due" };
  }
}

export function describeRule(r: Rule, campaignName?: (id: string) => string | null): string {
  switch (r.r) {
    case "all":
      return "everyone on the list";
    case "tier":
      return r.v === "Insiders+" ? "Insiders+ members" : "free Insiders";
    case "consent":
      return `consent: ${r.v.join(", ").replace(/_/g, " ")}`;
    case "legacy_plus":
      return "paid or Plus on the old website";
    case "joined_within":
      return `joined in the last ${r.days} days`;
    case "birthday_within":
      return `birthday in the next ${r.days} days`;
    case "visit_days":
      return `${r.min}+ visit days in ${r.within} days`;
    case "lapsed":
      return `came in before, nothing for ${r.days}+ days`;
    case "never_visited":
      return "never come in";
    case "archive_fans":
      return `${r.min}+ classic screenings in ${r.within} days`;
    case "genre":
      return `${r.min}+ ${r.v} screenings in ${r.within} days`;
    case "bar":
      return `${r.min}+ ${r.v === "alcohol" ? "bar" : r.v === "coffee" ? "coffee bar" : "kitchen"} orders in ${r.within} days`;
    case "paid_tickets":
      return `${r.min}+ paid tickets in ${r.within} days`;
    case "clicked_within":
      return `clicked an email in the last ${r.days} days`;
    case "clicked_campaign":
      return `clicked "${campaignName?.(r.id) ?? "an email"}"`;
    case "received_campaign":
      return `got "${campaignName?.(r.id) ?? "an email"}"`;
    case "engaged":
      return `clicked or came in within ${r.days} days`;
    case "has_login":
      return r.v ? "has a website login" : "no website login yet";
    case "has_phone":
      return r.v ? "a phone number on file" : "no phone number on file";
    case "legacy_needs_setup":
      return "former unlimited members with nothing paying for their Insiders+ now";
    case "old_site":
      return r.v ? "had an old-website account" : "never had an old-website account";
    case "sunset_due":
      return "due a \"Still want these?\"";
  }
}

// The spec's segments, ready to pick.
export const PRESETS: { key: string; label: string; audience: Audience }[] = [
  { key: "all", label: "Whole list", audience: { include: [{ r: "all" }] } },
  { key: "said_yes", label: "Said yes in their own words (Indy)", audience: { include: [{ r: "consent", v: ["indy_yes"] }] } },
  { key: "old_site", label: "Old-site only", audience: { include: [{ r: "consent", v: ["old_site_import"] }] } },
  { key: "new", label: "New sign-ups (30 days)", audience: { include: [{ r: "joined_within", days: 30 }] } },
  { key: "plus", label: "Insiders+", audience: { include: [{ r: "tier", v: "Insiders+" }] } },
  { key: "free", label: "Free Insiders", audience: { include: [{ r: "tier", v: "Insiders" }] } },
  { key: "former_paying", label: "Insiders+ prospects: former paying", audience: { include: [{ r: "legacy_plus" }, { r: "tier", v: "Insiders" }] } },
  { key: "ticket_buyers", label: "Insiders+ prospects: 2+ paid tickets in 30 days", audience: { include: [{ r: "tier", v: "Insiders" }, { r: "paid_tickets", within: 30, min: 2 }] } },
  { key: "birthday", label: "Birthday this week", audience: { include: [{ r: "birthday_within", days: 7 }] } },
  { key: "regulars", label: "Regulars (3+ visit days in 30)", audience: { include: [{ r: "visit_days", within: 30, min: 3 }] } },
  { key: "lapsed30", label: "Lapsed 30 days", audience: { include: [{ r: "lapsed", days: 30 }] } },
  { key: "lapsed60", label: "Lapsed 60 days", audience: { include: [{ r: "lapsed", days: 60 }] } },
  { key: "lapsed90", label: "Lapsed 90 days", audience: { include: [{ r: "lapsed", days: 90 }] } },
  { key: "classics", label: "Classic-film fans", audience: { include: [{ r: "archive_fans", within: 90, min: 2 }] } },
  { key: "coffee", label: "Coffee regulars", audience: { include: [{ r: "bar", v: "coffee", within: 30, min: 2 }] } },
  { key: "bar", label: "Bar regulars", audience: { include: [{ r: "bar", v: "alcohol", within: 30, min: 2 }] } },
  { key: "indy_returners", label: "Indy returners (said yes, never on the old site)", audience: { include: [{ r: "consent", v: ["indy_yes"] }, { r: "old_site", v: false }] } },
  { key: "engaged", label: "Engaged (60 days)", audience: { include: [{ r: "engaged", days: 60 }] } },
  { key: "invite", label: "Invite: no website login yet (warm-up order)", audience: { include: [{ r: "has_login", v: false }], order: "trust" } },
];

// Consent sources, in a form picker's order.
export const CONSENT_CHOICES: ConsentSource[] = ["indy_yes", "old_site_import", "join_form", "kiosk", "checkout", "claim", "account", "staff", "indy_no", "unknown"];

// Deterministic 0..99 from a hex digest (the server makes the digest).
export function bucketOf(hexDigest: string): number {
  return parseInt(hexDigest.slice(0, 8), 16) % 100;
}
