// Check-in for points, shared by the customer screen (which checks people
// in) and the register (which shows staff who just came in). They talk over
// their own Realtime broadcast channel, next to the cart mirror's (see
// registerChannel.ts), named from the same server-side secret.
//
// Typing a phone number or email at the screen is the check-in (Andrew,
// 10/2): the screen's server action records the visit and pays its points
// there and then, and the screen plays the reward. Nothing on the channel
// identifies anyone: a request carries only an opaque, sealed reference
// (lib/checkin-server.ts) that the register trades for the details through
// a staff-only server action, to show who it is and put them on the order,
// with Undo for a mistake. A shared family number asks "Which one is you?"
// on the screen (first names and last initials only). The screen gets a
// first name and a points balance, their profile line (unless staff hid
// it) and their check-in flair as catalog keys (lib/flair.ts), never
// anything else.
//
// Events:
//   screen -> register  "checkin-request"   CheckinRequest (resent until seen)
//   screen -> register  "checkin-cancel"    { id }  the customer backed out
//   register -> screen  "checkin-seen"      { id }  the register is showing it
//   register -> screen  "checkin-confirmed" CheckinConfirmed
//   register -> screen  "checkin-declined"  { id }  Not them / Cancel
//   register -> screen  "checkin-sync"      {}  a register (re)joined: resend
//   register -> screen  "points-earned"     PointsEarned (a member's sale)
//   server -> screen    "rewind"            RewindFound (Back office's Rewind
//                       gave a member points for their visits before the new
//                       system; sent by the server, lib/tablet-broadcast.ts)
//   register -> screen  "plus-finish"       PlusFinish: a QR code for a former
//                       unlimited member to put their card on Stripe's page
//                       from their own phone (lib/legacy-plus.ts)
//   register -> screen  "plus-finish-close" {}  take that QR code down
//   register -> screen  "plus-welcome"      PlusWelcome: their Insiders+ is set up
// A second register on the same channel also hears confirmed/declined, and
// drops its copy of that card.

import type { EarnedBadge } from "@/lib/visits";
import { isGuestName } from "@/lib/member-name";

export type CheckinKind = "known" | "new";

// done: the visit is already recorded and paid (Andrew, 10/2: typing your
// number or email at the screen IS the check-in), so the register just shows
// who it is, puts them on the order and offers Undo. Without it (from a
// screen that hasn't updated since 10/2) the register lets it go.
// The register never trusts this flag: the sealed reference says the same.
export interface CheckinRequest {
  id: string;
  ref: string;
  kind: CheckinKind;
  done?: boolean;
}

// What the screen gets back the moment its check-in is recorded (display/
// customer/actions.ts): the same things a register's confirmation carries,
// for the reward that plays there.
export type TabletCheckin = Omit<CheckinConfirmed, "id" | "claimUrl">;

export interface CheckinConfirmed {
  id: string;
  firstName: string;
  points: number; // balance, after any visit points
  isNew: boolean;
  // Today's visit (lib/visits.ts): the check-in's points, their week
  // streak, and any new badges (each with its points and reward). earned is
  // everything it paid. Missing if the visit couldn't be saved.
  visit?: { earned: number; visitPoints: number; weekStreak: number; alreadyToday: boolean; badges: EarnedBadge[] };
  // "Scan to see your points online": a member with no login yet, confirmed
  // by staff at a register from before 10/2. The screen only shows it if it
  // passes isClaimUrl.
  claimUrl?: string;
  // Their entrance (lib/flair.ts): catalog keys only, which the screen looks
  // up in its own catalog (anything unknown plays as classic). entrance is
  // their effect, or "party" in their birthday week. Missing from an older
  // register.
  flair?: CheckinFlair;
  // Their profile line (lib/member-profile.ts), unless staff hid it.
  line?: string;
}

export interface CheckinFlair {
  color: string | null;
  entrance: string;
  sticker: string;
  // Their sign-in sound, unlocked with points (lib/rewards.ts PERK_SOUNDS):
  // plays instead of the coin. Missing: the coin.
  sound?: string | null;
}

export interface PointsEarned {
  orderNumber: number;
  firstName: string;
  earned: number;
  balance: number;
  color?: string | null; // their flair color's key, for the confetti
}

// "Welcome back, Jane! We found 37 visits since March 2023. +412 points."
// First name, counts and a month only: never contact details or card digits.
export interface RewindFound {
  firstName: string;
  visits: number;
  since: string; // "March 2023"
  earned: number;
  balance: number;
  color?: string | null; // their flair color's key, for the confetti
}

// The screen only shows a url that passes isPlusFinishUrl, and words for
// the plan from its own price list (never text off the channel).
export interface PlusFinish {
  firstName: string;
  url: string;
  tier: "adult" | "senior" | "student";
  interval: "month" | "year";
}

export interface PlusWelcome {
  firstName: string;
}

export function checkinTopic(registerTopic: string): string {
  return `${registerTopic}:checkin`;
}

// Digits only, without a leading US country code: "+1 (417) 555-1234" and
// "417.555.1234" both give "4175551234".
export function phoneDigits(input: string): string {
  const d = input.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

// The last ten digits of a phone stored however it was typed.
export function last10(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

// A full US number (area codes never start with 0 or 1).
export function isFullPhone(digits: string): boolean {
  return /^[2-9]\d{9}$/.test(digits);
}

// "(417) 555-1234", or as much of it as has been typed so far.
export function formatPhone(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// A phone account's "Guest ·· 0199" (lib/member-name.ts) comes back whole.
export function firstNameOf(name: string): string {
  if (isGuestName(name)) return name.trim();
  return name.trim().split(/\s+/)[0] || "there";
}

// Letters (any alphabet), spaces, hyphens, apostrophes and periods, up to 40
// characters. Built with the RegExp constructor since the \p{} classes need a
// newer target than this project compiles to.
const NAME_PATTERN = new RegExp("^[\\p{L}\\p{M}][\\p{L}\\p{M}'’. -]*$", "u");

// A first name as typed on the customer screen, tidied up (extra spaces out,
// first letter capitalised), or null if it isn't a name.
export function cleanFirstName(input: string): string | null {
  const t = input.trim().replace(/\s+/g, " ");
  if (!t || t.length > 40 || !NAME_PATTERN.test(t)) return null;
  return t.charAt(0).toLocaleUpperCase() + t.slice(1);
}

// Lowercased and trimmed, or null if it doesn't look like an address.
export function cleanEmail(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t || t.length > 254 || !/^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[a-z]{2,}$/.test(t)) return null;
  return t;
}
