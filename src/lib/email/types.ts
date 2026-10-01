// The words and shapes shared by every part of email marketing: the
// composer in the browser, the sender, the webhook and the check script.
// Plain data, no server code.

// ---------- what people can choose ----------
export const PREF_CATEGORIES = ["lineup", "alerts", "events", "offers", "rewards"] as const;
export type PrefCategory = (typeof PREF_CATEGORIES)[number];
// 'account' is the invite and "Still want these?": not a choice, and not
// counted against the caps, but still only to people who are opted in.
export type Category = PrefCategory | "account";

export const CATEGORY_LABEL: Record<PrefCategory, { label: string; about: string }> = {
  lineup: { label: "Weekly lineup", about: "What's playing each week, Tuesday mornings. Includes the members-only classics." },
  alerts: { label: "This weekend, last chance and tonight", about: "Only when there's real news, at most one a week." },
  events: { label: "Events and trivia", about: "Trivia nights, comedy, the book swap. At most two a month." },
  offers: { label: "Offers and Insiders+ news", about: "Deals and Insiders+ perks. At most one a month." },
  rewards: { label: "My rewards and birthday", about: "Your welcome, your birthday week, points and badges." },
};

// ---------- campaigns ----------
export const CAMPAIGN_KINDS = ["lineup", "alert", "event", "offer", "invite", "announcement", "automation", "reconfirm"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const AUTOMATIONS = ["welcome_1", "welcome_2", "welcome_3", "birthday", "plus_upsell", "winback_45", "winback_90", "reconfirm"] as const;
export type Automation = (typeof AUTOMATIONS)[number];

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled" | "failed" | "active" | "off";
export type SendStatus = "queued" | "held_out" | "submitted" | "scheduled" | "delivered" | "bounced" | "complained" | "failed" | "cancelled" | "suppressed";

export type AlertType = "tonight" | "weekend" | "last_chance" | "just_added";

export const KIND_LABEL: Record<CampaignKind, string> = {
  lineup: "Weekly lineup",
  alert: "Tonight or this weekend",
  event: "Event",
  offer: "Offer",
  invite: "Invite",
  announcement: "Announcement",
  automation: "Automation",
  reconfirm: "Still want these?",
};

// The category each kind lives in (an announcement picks its own).
export const KIND_CATEGORY: Record<Exclude<CampaignKind, "automation" | "announcement">, Category> = {
  lineup: "lineup",
  alert: "alerts",
  event: "events",
  offer: "offers",
  invite: "account",
  reconfirm: "account",
};

export const AUTOMATION_LABEL: Record<Automation, { label: string; about: string; category: Category }> = {
  welcome_1: { label: "Welcome #1", about: "Right after someone joins or claims their account: their member card and how points work.", category: "rewards" },
  welcome_2: { label: "Welcome #2: walk in free", about: "Free members, 3 days after joining: how Insiders+ works.", category: "rewards" },
  welcome_3: { label: "Welcome #3: here's this week", about: "10 days after joining, only if they haven't come in yet.", category: "rewards" },
  birthday: { label: "Birthday week", about: "Monday of the week holding their birthday, 10:30 AM.", category: "rewards" },
  plus_upsell: { label: "Insiders+, personal", about: "A free member who bought 2+ paid tickets in 30 days. Once in 60 days.", category: "offers" },
  winback_45: { label: "Win-back, 45 days", about: "Came in before, nothing for 45 days.", category: "rewards" },
  winback_90: { label: "Win-back, 90 days", about: "Came in before, nothing for 90 days. Then nothing for 6 months.", category: "rewards" },
  reconfirm: { label: "Still want these?", about: "Once, to people who never click or come in. No answer in 14 days and they go quiet.", category: "account" },
};

// Who goes first when two emails compete for the same person's caps
// (lower goes first). The lineup has its own weekly slot.
export function priorityOf(c: { kind: CampaignKind; automation: Automation | null; category: Category }): number {
  if (c.category === "account") return 0;
  if (c.kind === "lineup") return 1;
  if (c.automation === "birthday") return 2;
  if (c.automation === "welcome_1" || c.automation === "welcome_2" || c.automation === "welcome_3") return 3;
  if (c.kind === "event") return 4;
  if (c.kind === "alert" || c.kind === "announcement") return 5;
  if (c.kind === "offer" || c.automation === "plus_upsell") return 6;
  return 7; // win-back
}

// ---------- consent ----------
export const CONSENT_SOURCES = ["old_site_import", "indy_yes", "indy_no", "join_form", "kiosk", "checkout", "claim", "account", "staff", "unknown"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const CONSENT_LABEL: Record<ConsentSource, string> = {
  old_site_import: "Came over from the old website",
  indy_yes: "Said yes on the old ticketing system (Indy)",
  indy_no: "Said no on the old ticketing system (Indy)",
  join_form: "Ticked the box on the join form",
  kiosk: "Chose at the check-in screen",
  checkout: "Ticked the box at checkout",
  claim: "Claimed their account",
  account: "Chose on their account page",
  staff: "Set by staff",
  unknown: "Not recorded (the old default)",
};

export type Engagement = "active" | "reconfirm_sent" | "dormant";

// ---------- segments ----------
export type Rule =
  | { r: "all" }
  | { r: "tier"; v: "Insiders" | "Insiders+" }
  | { r: "consent"; v: ConsentSource[] }
  | { r: "legacy_plus" }
  | { r: "joined_within"; days: number }
  | { r: "birthday_within"; days: number }
  | { r: "visit_days"; within: number; min: number }
  | { r: "lapsed"; days: number }
  | { r: "never_visited" }
  | { r: "archive_fans"; within: number; min: number }
  | { r: "genre"; v: string; within: number; min: number }
  | { r: "bar"; v: "alcohol" | "coffee" | "food"; within: number; min: number }
  | { r: "paid_tickets"; within: number; min: number }
  | { r: "clicked_within"; days: number }
  | { r: "clicked_campaign"; id: string }
  | { r: "received_campaign"; id: string }
  | { r: "engaged"; days: number }
  | { r: "has_login"; v: boolean }
  | { r: "old_site"; v: boolean }
  | { r: "sunset_due" };

export type RuleKey = Rule["r"];

export interface Audience {
  include: Rule[];
  exclude?: Rule[];
  limit?: number;
  order?: "trust" | "random";
}

// Why someone isn't getting an email, counted per campaign.
export const EXCLUSIONS = [
  "opted_out",
  "pref_off",
  "paused",
  "dormant",
  "suppressed",
  "already_sent",
  "segment",
  "cap_day",
  "cap_week",
  "cap_extra",
  "cap_month",
  "cap_kind",
  "wave_limit",
  "bad_address",
] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

export const EXCLUSION_LABEL: Record<Exclusion, string> = {
  opted_out: "Email turned off",
  pref_off: "Turned this kind of email off",
  paused: "Paused",
  dormant: "Gone quiet (never clicks or comes in)",
  suppressed: "On the never-mail list (bounced or complained)",
  already_sent: "Already got it",
  segment: "Not in this audience",
  cap_day: "Had an email in the last 20 hours",
  cap_week: "Already had 2 this week",
  cap_extra: "Already had this week's extra",
  cap_month: "Already had 8 this month",
  cap_kind: "Had one like this recently",
  wave_limit: "Waiting for the next wave",
  bad_address: "Address doesn't look deliverable",
};

// ---------- facts about one member (member_email_facts) ----------
export interface SendRecord {
  c: string; // campaign id
  t: string; // deliver_at, submitted_at or created_at
  k: CampaignKind;
  a: Automation | null;
  g: Category;
  x: string | null; // alert type
  s: SendStatus;
  ck: boolean; // clicked
}

export interface TicketRecord {
  d: string; // bought at
  q: number;
  p: number; // unit price
}

export interface OrderRecord {
  d: string; // completed at
  a: boolean; // alcohol
  c: boolean; // coffee bar
  f: boolean; // kitchen
  t: number; // total
}

export interface MemberFacts {
  memberId: string;
  email: string;
  emailHash: string;
  name: string;
  tier: "Insiders" | "Insiders+";
  legacyPlus: boolean;
  imported: boolean; // from the old site or Indy
  fromOldSite: boolean; // had an account on the old website
  hasLogin: boolean;
  hasPhone: boolean;
  createdAt: string;
  birthday: string | null; // "2000-MM-DD"
  emailOptIn: boolean;
  prefs: Record<PrefCategory, boolean>;
  pausedUntil: string | null;
  consentSource: ConsentSource;
  importGroup: "paying" | "likely_real" | "review" | null;
  engagement: Engagement;
  reconfirmSentAt: string | null;
  lastEngagedAt: string | null;
  suppressed: string | null; // the suppression reason
  visitDays: string[]; // business dates, last 180 days
  archiveDays: string[];
  firstVisitOn: string | null;
  lastVisitOn: string | null;
  tickets: TicketRecord[];
  orders: OrderRecord[];
  lastClickAt: string | null;
  sends: SendRecord[];
  deliveredSinceEngaged: number;
  inviteDelivered: boolean;
}

// Statuses that mean the email went (or is on its way) to them.
export const SENT_STATUSES: ReadonlySet<SendStatus> = new Set(["queued", "submitted", "scheduled", "delivered", "bounced", "complained"]);
