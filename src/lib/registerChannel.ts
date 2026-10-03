// Shared between the POS (sender) and the customer-facing kiosk display
// (receiver): a Supabase Realtime broadcast channel, deliberately NOT
// backed by a database table. An in-progress cart isn't persisted anywhere
// until it's held, tabbed, or completed, so mirroring it live has to be
// pure pub/sub rather than routing through payment-critical order rows.
// The channel's name is a server-side secret -- see lib/register-topic.ts.

export interface RegisterCartSnapshot {
  orderName: string;
  // lineTotal: the line's price (unit x quantity). Optional fields let an
  // older screen or register keep working mid-update.
  items: { name: string; quantity: number; modifiers: string[]; lineTotal?: number }[];
  subtotal: number;
  tax: number;
  total: number;
  discounts?: { label: string; amount: number }[];
  // Who's on this order, for the live tally, their account panel and their
  // card (the customer screen's MemberCards.tsx). Only what the screen
  // shows: never an email, phone, full name or member id.
  // plus: Insiders+ that's paid for (pos/member-signal.ts): the gold badge.
  // unlimited: a former unlimited member with nothing paying for it
  // (lib/legacy-plus.ts). noCard: Insiders+ set by hand with nothing paying
  // for it. Either keeps a red "add your card" card up beside the order
  // until it's set up or they're taken off the order.
  // coffee: an Insiders+ member's free coffee today (lib/daily-perk.ts),
  // missing while it's unknown. discountPct: their member discount on this
  // order (10 for Insiders+, 0 for plain Insiders: points only).
  // profile: their card, while nothing's rung up yet (missing until it's
  // looked up, or if it couldn't be).
  // Everything after `plus` is optional, so an older screen or register
  // keeps working mid-update.
  member?: {
    firstName: string;
    points: number;
    plus: boolean;
    unlimited?: boolean;
    noCard?: boolean;
    coffee?: "ready" | "on-order" | "used" | null;
    discountPct?: number;
    profile?: TabletProfile | null;
  } | null;
  pointsToEarn?: number;
}

// The outward-facing side of a member's profile (lib/member-profile.ts), as
// the customer screen shows it to them while they're at the bar. Keys into
// the screen's own catalogs (lib/flair.ts, lib/visits.ts) rather than
// anything to draw as-is; the screen checks every one.
export interface TabletProfile {
  // Their display name: first name and last initial unless they chose one.
  name: string;
  // A sealed reference to their photo (lib/tablet-photo.ts), served by
  // /display/customer/photo/<ref>. Never the photo's stored address: that
  // holds the member id, which works like a password at the door.
  photo: string | null;
  // Their profile line; null while staff have it hidden.
  line: string | null;
  color: string | null; // flair color key, null: not picked
  entrance: string | null; // entrance effect key, null: classic
  badges: string[]; // earned badge keys, in the cabinet's order
  // What's still to do on their account's Profile tab ("Make it yours").
  // A line staff hid isn't asked for again.
  todo: { photo: boolean; line: boolean; flair: boolean };
}

export const EMPTY_CART_SNAPSHOT: RegisterCartSnapshot = { orderName: "", items: [], subtotal: 0, tax: 0, total: 0 };

// Staff setting up a guest's account on the register, for a guest who'd
// rather just tell them: the "New phone account" form (MemberFinder.tsx),
// or "+ Add name" / "+ Add email" on the member box (PosMemberPanel.tsx).
// The customer screen mirrors it as they type ("We're setting up your
// account"), so the guest can check it and tap "✓ That's right"
// ("staff-setup-ok" { id }, back to the register, which saves it). Only
// what's being typed, and only so much of it: the phone number, a first
// name and last initial, an email masked (maskEmail). Never a member id,
// never anything already on the account.
// "staff-setup": this, as they type (debounced) and once it's saved;
// "staff-setup-end" ({ id }): Cancel, the screen goes back to normal.
export interface StaffSetup {
  id: string; // this form, opened once
  stage: "typing" | "saved";
  what: "phone" | "name" | "email";
  phone?: string; // "(417) 555-01", as typed so far
  name?: string; // "Sarah M."
  email?: string; // "s•••@gmail.com"
  ready?: boolean; // what's typed could be saved: "✓ That's right" works
  hold?: boolean; // the register couldn't save it: staff are on it
}

// "Done" or "That's not me" under the member's card on the customer
// screen: off the order ("member-off", to the register). firstName: the
// one the screen shows (the cart's member.firstName), so a register that's
// moved on to someone else leaves them be.
export interface MemberOff {
  firstName: string;
  why: "done" | "not-me";
}

// Register → ✨ → Rickroll (pos/EasterEggs.tsx, display/customer/Rickroll.tsx):
// "rickroll" ({ play: true }) puts it on the customer screen and
// "rickroll-stop" takes it off. The screen answers every one with
// "rickroll-state" (this), and says so again when the clip ends by itself or
// someone taps ✕. The register's button changes only on this answer, from
// any screen that's listening.
export interface RickrollState {
  playing: boolean;
}

// Mail providers shown whole; any other domain is masked like the name.
const COMMON_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "att.net",
  "sbcglobal.net",
  "comcast.net",
  "proton.me",
  "protonmail.com",
]);

// "sarah.miller@gmail.com" -> "s•••@gmail.com"; "sam@millerlaw.com" ->
// "s•••@m•••.com". As much as is typed so far: "sar" -> "s•••".
export function maskEmail(input: string): string {
  const t = input.trim().toLowerCase().slice(0, 254);
  if (!t) return "";
  const at = t.indexOf("@");
  const local = at < 0 ? t : t.slice(0, at);
  const head = local ? `${local[0]}•••` : "";
  if (at < 0) return head;
  const domain = t.slice(at + 1);
  if (!domain || COMMON_MAIL.has(domain)) return `${head}@${domain}`;
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot, dot + 8) : "";
  return `${head}@${domain[0]}•••${tld}`;
}

// "Sarah" and "Miller" -> "Sarah M.": a first name and last initial only.
export function setupName(first: string, last = ""): string {
  const f = first.trim().replace(/\s+/g, " ").slice(0, 40);
  const l = last.trim().charAt(0).toLocaleUpperCase();
  return f && l ? `${f} ${l}.` : f;
}
