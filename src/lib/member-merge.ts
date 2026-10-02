// Merging two member accounts that are the same person (Back office →
// Members, Andrew 10/1). The usual case: a regular imported from the old
// website with no usable phone checks in at the door tablet by phone, the
// tablet can't find them, and makes a second account.
//
// The merge itself is the database function merge_members (migration
// 20261001150000), one transaction. This file is the same rules in plain
// code, for the preview staff see before they confirm (what moves, what's
// kept, why it can't be done) and for spotting likely duplicates. No
// database here, so scripts/check-member-merge.mjs can check it directly.
// Change a rule in one place, change it in the other.

import { firstNameOf, isFullPhone, last10 } from "@/lib/checkin";

// What the rules look at. Contact details only ever reach this as the
// server has them; what reaches a page is masked for the viewer's role
// (lib/contact-mask.ts) before it leaves the server.
export interface MergeMember {
  id: string;
  name: string;
  tier: string; // "Insiders" | "Insiders+"
  points: number;
  created_at: string;
  last_activity_at: string | null;
  email: string | null;
  phone: string | null;
  auth_user_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  price_tier: string | null;
  birthday: string | null;
  avatar_url: string | null;
  tagline: string | null;
  comped: boolean;
  plus_gift_until: string | null;
  legacy_user_id: number | null;
  imported_at: string | null;
  indy_user_id: string | null; // migration 20261001090000
  email_opt_in: boolean;
  email_opt_in_changed_at: string | null;
  monthly_member: boolean;
  erased_at: string | null;
  // The profile page and check-in flair (migration 20261001120000).
  tagline_hidden_at: string | null;
  share_profile: boolean;
  profile_handle: string | null;
  display_name: string | null;
  profile_hidden_at: string | null;
  flair_color: string | null;
  flair_effect: string | null;
  flair_sticker: string | null;
  birthday_party: boolean;
}

// The member columns these rules need (and nothing else).
// scripts/check-member-merge.mjs holds this to every column the
// migrations give members: each is either here or listed there with why
// the preview doesn't need it.
export const MERGE_MEMBER_COLUMNS =
  "id, name, tier, points, created_at, last_activity_at, email, phone, auth_user_id, stripe_customer_id, stripe_subscription_id, subscription_status, price_tier, birthday, avatar_url, tagline, comped, plus_gift_until, legacy_user_id, imported_at, indy_user_id, email_opt_in, email_opt_in_changed_at, monthly_member, erased_at, tagline_hidden_at, share_profile, profile_handle, display_name, profile_hidden_at, flair_color, flair_effect, flair_sticker, birthday_party";

// A phone the door tablet can find them by: ten digits that make a US
// number (a leading 1 is fine). The old site's placeholder "-" and the odd
// junk value aren't. Same test as the database's
// right(phone_digits, 10) ~ '^[2-9][0-9]{9}$'.
export function usablePhone(phone: string | null | undefined): boolean {
  return isFullPhone(last10(phone));
}

// "  Jake   Smith " and "jake smith" are the same name.
export function normalName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function hasLogin(m: Pick<MergeMember, "auth_user_id">): boolean {
  return !!m.auth_user_id;
}

export function hasBilling(m: Pick<MergeMember, "stripe_customer_id" | "stripe_subscription_id">): boolean {
  return !!(m.stripe_customer_id || m.stripe_subscription_id);
}

// Why these two can't be merged, word for word what merge_members raises
// (the check script holds the two to the same text), or null if they can.
export const REFUSE_SAME = "Those are the same account.";
export const REFUSE_MISSING = "One of these accounts is gone. It may have been merged or removed already.";
export const REFUSE_ERASED = "One of these accounts had its personal info removed, so it cannot be merged.";
export const REFUSE_LOGINS = "Both accounts have a website login, and an account can only have one, so these cannot be merged here.";
export const REFUSE_BILLING = "Both accounts have Stripe billing on file, and an account can only have one, so these cannot be merged here.";

export function mergeRefusal(keep: MergeMember | null, drop: MergeMember | null): string | null {
  if (keep && drop && keep.id === drop.id) return REFUSE_SAME;
  if (!keep || !drop) return REFUSE_MISSING;
  if (keep.erased_at || drop.erased_at) return REFUSE_ERASED;
  if (hasLogin(keep) && hasLogin(drop)) return REFUSE_LOGINS;
  if (hasBilling(keep) && hasBilling(drop)) return REFUSE_BILLING;
  return null;
}

// What the kept account takes from the other one, by the key
// merge_members logs in member_merges.carried, with the words staff see.
export const CARRIED_LABEL = {
  name: "their full name",
  email: "the email",
  phone: "the phone number",
  login: "the website login",
  billing: "the Insiders+ billing (Stripe)",
  rate: "the senior or student rate",
  birthday: "the birthday",
  photo: "the photo",
  tagline: "their profile line",
  line_hidden: "staff's hide on their profile line (it stays hidden)",
  profile_page: "their profile page and its link",
  display_name: "the name on their profile page",
  page_hidden: "staff turning their profile page off (it stays off)",
  flair: "their check-in flair",
  party_off: "their birthday party turned off",
  free_membership: "the free (community) membership",
  gift: "the gifted Insiders+ time",
  old_site: "the old-site link",
  indy: "the Indy import link",
  tier: "Insiders+",
  email_choice: "their email preference",
  member_since: "the earlier member-since date",
} as const;
export type CarriedKey = keyof typeof CARRIED_LABEL;

type From = "keep" | "drop";

// The kept account as it will be after the merge.
export interface MergedProfile {
  name: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  hasBilling: boolean;
  tier: string;
  createdAt: string;
  lastActivityAt: string | null;
  points: number;
  birthday: string | null;
  avatarUrl: string | null;
  tagline: string | null;
  lineHidden: boolean;
  shareProfile: boolean;
  profileHandle: string | null;
  displayName: string | null;
  pageHidden: boolean;
  flair: { color: string | null; effect: string | null; sticker: string | null };
  birthdayParty: boolean;
  comped: boolean;
  giftUntil: string | null;
  // Both accounts had gifted Insiders+ time left, so it adds up.
  giftStacked: boolean;
  emailOptIn: boolean;
  // Where each piece comes from.
  from: { name: From; email: From | null; phone: From | null; login: From | null; billing: From | null; emailOptIn: From; profile: From | null };
  carried: CarriedKey[];
  // What the duplicate has that won't survive, because the kept account
  // already has its own (shown in the preview so nothing is a surprise).
  notKept: ("name" | "email" | "phone" | "birthday" | "photo" | "tagline" | "profile_page" | "flair")[];
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

// The rules, the same as merge_members:
// - Anything the kept account lacks comes over: a usable phone, an email,
//   the website login, Stripe billing (with its rate and plan), a
//   senior/student rate (unless Stripe bills the kept account at its own),
//   birthday, photo, their profile line, the profile page (link, on/off and
//   name together), check-in flair (as a set), a free membership, the
//   old-site link.
// - Staff's moderation goes with the person: a profile line or page staff
//   hid on either account stays hidden (and the page off). A birthday
//   party turned off on either stays off.
// - The duplicate's profile link, when the kept account keeps its own, is
//   held for the member for 90 days (merge_members does that).
// - A one-word name ("Jake", from a quick sign-up at the register) gives
//   way to the other account's full name when that starts with it.
// - The higher tier wins. Gifted Insiders+ time left on both adds up (as
//   gifts stack on one account); otherwise the later end.
// - Their email choice is the later one either account recorded (the
//   order setMarketingOptIn keeps), else the kept account's.
// - Member since is the earlier date, last activity the later; the points
//   add up.
export function mergedProfile(keep: MergeMember, drop: MergeMember, now: Date = new Date()): MergedProfile {
  const carried: CarriedKey[] = [];
  const notKept: MergedProfile["notKept"] = [];

  const kName = keep.name.trim();
  const dName = drop.name.trim();
  let name = keep.name;
  let nameFrom: From = "keep";
  if (!/\s/.test(kName) && dName.toLowerCase().startsWith(`${kName.toLowerCase()} `)) {
    name = dName;
    nameFrom = "drop";
    carried.push("name");
  } else if (normalName(kName) !== normalName(dName)) {
    notKept.push("name");
  }

  let email = keep.email;
  let emailFrom: From | null = keep.email?.trim() ? "keep" : null;
  if (!keep.email?.trim() && drop.email?.trim()) {
    email = drop.email;
    emailFrom = "drop";
    carried.push("email");
  } else if (keep.email && drop.email && keep.email.trim().toLowerCase() !== drop.email.trim().toLowerCase()) {
    notKept.push("email");
  }

  let phone = keep.phone;
  let phoneFrom: From | null = keep.phone ? "keep" : null;
  if (!usablePhone(keep.phone) && usablePhone(drop.phone)) {
    phone = drop.phone;
    phoneFrom = "drop";
    carried.push("phone");
  } else if (usablePhone(keep.phone) && usablePhone(drop.phone) && last10(keep.phone) !== last10(drop.phone)) {
    notKept.push("phone");
  }

  let loginFrom: From | null = hasLogin(keep) ? "keep" : null;
  if (!hasLogin(keep) && hasLogin(drop)) {
    loginFrom = "drop";
    carried.push("login");
  }

  let billingFrom: From | null = hasBilling(keep) ? "keep" : null;
  if (!hasBilling(keep) && hasBilling(drop)) {
    billingFrom = "drop";
    carried.push("billing");
  } else if (!hasBilling(keep) && !keep.price_tier && drop.price_tier) {
    // Not onto an account Stripe is billing: its rate is what Stripe charges.
    carried.push("rate");
  }

  const birthday = keep.birthday ?? drop.birthday;
  if (!keep.birthday && drop.birthday) carried.push("birthday");
  else if (keep.birthday && drop.birthday && keep.birthday !== drop.birthday) notKept.push("birthday");

  const avatarUrl = keep.avatar_url ?? drop.avatar_url;
  if (!keep.avatar_url && drop.avatar_url) carried.push("photo");
  else if (keep.avatar_url && drop.avatar_url && keep.avatar_url !== drop.avatar_url) notKept.push("photo");

  // (The database's coalesce: an empty line still counts as one.)
  const tagline = keep.tagline ?? drop.tagline;
  if (keep.tagline == null && drop.tagline != null) carried.push("tagline");
  else if (keep.tagline != null && drop.tagline != null && keep.tagline !== drop.tagline) notKept.push("tagline");
  let lineHidden = !!keep.tagline_hidden_at;
  if (!keep.tagline_hidden_at && drop.tagline_hidden_at) {
    lineHidden = true;
    carried.push("line_hidden");
  }

  let shareProfile = !!keep.share_profile;
  let profileHandle = keep.profile_handle;
  let displayName = keep.display_name;
  let profileFrom: From | null = keep.profile_handle ? "keep" : null;
  if (keep.profile_handle == null && drop.profile_handle != null) {
    shareProfile = !!drop.share_profile;
    profileHandle = drop.profile_handle;
    displayName = drop.display_name ?? keep.display_name;
    profileFrom = "drop";
    carried.push("profile_page");
  } else if (keep.display_name == null && drop.display_name != null) {
    displayName = drop.display_name;
    carried.push("display_name");
  }
  if (keep.profile_handle != null && drop.profile_handle != null) notKept.push("profile_page");
  let pageHidden = !!keep.profile_hidden_at;
  if (!keep.profile_hidden_at && drop.profile_hidden_at) {
    pageHidden = true;
    carried.push("page_hidden");
  }
  if (pageHidden) shareProfile = false;

  const kFlair = { color: keep.flair_color, effect: keep.flair_effect, sticker: keep.flair_sticker };
  const dFlair = { color: drop.flair_color, effect: drop.flair_effect, sticker: drop.flair_sticker };
  const anyFlair = (f: typeof kFlair) => f.color != null || f.effect != null || f.sticker != null;
  let flair = kFlair;
  if (!anyFlair(kFlair) && anyFlair(dFlair)) {
    flair = dFlair;
    carried.push("flair");
  } else if (anyFlair(kFlair) && anyFlair(dFlair) && JSON.stringify(kFlair) !== JSON.stringify(dFlair)) {
    notKept.push("flair");
  }
  const kParty = keep.birthday_party !== false;
  const dParty = drop.birthday_party !== false;
  const birthdayParty = kParty && dParty;
  if (kParty && !dParty) carried.push("party_off");

  const comped = keep.comped || drop.comped;
  if (!keep.comped && drop.comped) carried.push("free_membership");

  let giftUntil = keep.plus_gift_until;
  let giftStacked = false;
  const kGift = time(keep.plus_gift_until);
  const dGift = time(drop.plus_gift_until);
  if (kGift > now.getTime() && dGift > now.getTime()) {
    giftUntil = new Date(Math.max(kGift, dGift) + (Math.min(kGift, dGift) - now.getTime())).toISOString();
    giftStacked = true;
    carried.push("gift");
  } else if (drop.plus_gift_until && (!keep.plus_gift_until || dGift > kGift)) {
    giftUntil = drop.plus_gift_until;
    carried.push("gift");
  }

  if (keep.legacy_user_id == null && drop.legacy_user_id != null) carried.push("old_site");
  if (keep.indy_user_id == null && drop.indy_user_id != null) carried.push("indy");

  const tier = keep.tier === "Insiders+" || drop.tier === "Insiders+" ? "Insiders+" : keep.tier;
  if (keep.tier !== "Insiders+" && drop.tier === "Insiders+") carried.push("tier");

  let emailOptIn = keep.email_opt_in;
  let optInFrom: From = "keep";
  if (drop.email_opt_in_changed_at && (!keep.email_opt_in_changed_at || time(drop.email_opt_in_changed_at) > time(keep.email_opt_in_changed_at))) {
    emailOptIn = drop.email_opt_in;
    optInFrom = "drop";
    carried.push("email_choice");
  }

  let createdAt = keep.created_at;
  if (time(drop.created_at) < time(keep.created_at)) {
    createdAt = drop.created_at;
    carried.push("member_since");
  }

  const lastTimes = [keep.last_activity_at, drop.last_activity_at].filter((t): t is string => !!t);
  const lastActivityAt = lastTimes.length ? lastTimes.reduce((a, b) => (time(b) > time(a) ? b : a)) : null;

  return {
    name,
    email,
    phone,
    hasLogin: hasLogin(keep) || hasLogin(drop),
    hasBilling: hasBilling(keep) || hasBilling(drop),
    tier,
    createdAt,
    lastActivityAt,
    points: Math.round((Number(keep.points) + Number(drop.points)) * 100) / 100,
    birthday,
    avatarUrl,
    tagline,
    lineHidden,
    shareProfile,
    profileHandle,
    displayName,
    pageHidden,
    flair,
    birthdayParty,
    comped,
    giftUntil,
    giftStacked,
    emailOptIn,
    from: { name: nameFrom, email: emailFrom, phone: phoneFrom, login: loginFrom, billing: billingFrom, emailOptIn: optInFrom, profile: profileFrom },
    carried,
    notKept,
  };
}

// Days both accounts checked in become one visit (the kept account's), so
// the visits after a merge are both sets less the overlap.
export function mergedVisitCount(keepDates: string[], dropDates: string[]): { total: number; sameDay: number } {
  const kept = new Set(keepDates);
  const all = new Set([...keepDates, ...dropDates]);
  return { total: all.size, sameDay: dropDates.filter((d) => kept.has(d)).length };
}

// A badge both earned (same badge, same period): the earlier one stays.
export function badgeOverlap(keep: { badge: string; period: string }[], drop: { badge: string; period: string }[]): number {
  const kept = new Set(keep.map((b) => `${b.badge}|${b.period}`));
  return drop.filter((b) => kept.has(`${b.badge}|${b.period}`)).length;
}

export function pointsText(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} point${v === 1 ? "" : "s"}`;
}

export function countText(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// "Jake will have 1 account with 65 points and 1 visit." (before), or
// "Jake now has 1 account with..." (after).
export function mergeSentence(name: string, points: number, visits: number, done = false): string {
  return `${firstNameOf(name)} ${done ? "now has" : "will have"} 1 account with ${pointsText(points)} and ${countText(visits, "visit")}.`;
}

// ---------- spotting duplicates ----------

export const RECENT_DAYS = 30;

export type DuplicateCandidate = Pick<MergeMember, "id" | "created_at" | "phone" | "legacy_user_id" | "imported_at"> & { email?: string | null };

function madeLately(m: DuplicateCandidate, now: Date): boolean {
  const age = now.getTime() - time(m.created_at);
  return m.legacy_user_id == null && !m.imported_at && age >= 0 && age <= RECENT_DAYS * 86_400_000;
}

// Made at the door tablet (or the register's quick sign-up) lately: a
// phone they can be found by, not imported from the old site, created in
// the last 30 days. Members has no "where it was made" column; this is
// the same test the register's hint uses.
export function isTabletMade(m: DuplicateCandidate, now: Date = new Date()): boolean {
  return madeLately(m, now) && usablePhone(m.phone);
}

// Made lately with an email and no usable phone: the tablet's "Phone or
// email" sign-up when they leave the phone out (Andrew, 10/1). A website
// sign-up looks the same, and is the same kind of duplicate.
export function isEmailSignUp(m: DuplicateCandidate, now: Date = new Date()): boolean {
  return madeLately(m, now) && !usablePhone(m.phone) && !!m.email?.trim();
}

// The likely kind: the newer account was made at the tablet lately (by
// phone, or by email with no phone), and the older one has the same name
// and no usable phone (so the tablet couldn't have found it by phone), or
// the same email (the tablet finds an email that's on an account, so this
// only happens when one slips past it).
export function isLikelyTabletDuplicate(older: DuplicateCandidate, newer: DuplicateCandidate, sameName: boolean, now: Date = new Date(), sameEmail = false): boolean {
  if (older.id === newer.id || time(older.created_at) > time(newer.created_at)) return false;
  if (!isTabletMade(newer, now) && !isEmailSignUp(newer, now)) return false;
  return sameEmail || (sameName && !usablePhone(older.phone));
}

// Which to keep by default: the older account (the old-site one, with the
// history); everything the newer one has that it lacks comes over anyway.
// Staff can swap it in the preview.
export function suggestKeep<T extends { id: string; created_at: string }>(a: T, b: T): { keep: T; drop: T } {
  const older = time(a.created_at) < time(b.created_at) || (time(a.created_at) === time(b.created_at) && a.id < b.id);
  return older ? { keep: a, drop: b } : { keep: b, drop: a };
}

export function mergeHref(keepId: string, dropId: string): string {
  return `/admin/members/${keepId}/merge?drop=${dropId}`;
}
