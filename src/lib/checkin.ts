// Check-in for points, shared by the customer screen (which asks) and the
// register (which confirms). They talk over their own Realtime broadcast
// channel, next to the cart mirror's (see registerChannel.ts), named from the
// same server-side secret.
//
// Nothing on the channel identifies anyone until staff say it's them: a
// request carries only an opaque, sealed reference (lib/checkin-server.ts)
// that the register trades for the details through a staff-only server
// action. After staff confirm, the screen gets a first name and a points
// balance, never anything else.
//
// Events:
//   screen -> register  "checkin-request"   CheckinRequest (resent until seen)
//   screen -> register  "checkin-cancel"    { id }  the customer backed out
//   register -> screen  "checkin-seen"      { id }  the register is showing it
//   register -> screen  "checkin-confirmed" CheckinConfirmed
//   register -> screen  "checkin-declined"  { id }  Not them / Cancel
//   register -> screen  "checkin-sync"      {}  a register (re)joined: resend
//   register -> screen  "points-earned"     PointsEarned (a member's sale)
// A second register on the same channel also hears confirmed/declined, and
// drops its copy of that card.

export type CheckinKind = "known" | "new";

export interface CheckinRequest {
  id: string;
  ref: string;
  kind: CheckinKind;
}

export interface CheckinConfirmed {
  id: string;
  firstName: string;
  points: number;
  isNew: boolean;
}

export interface PointsEarned {
  orderNumber: number;
  firstName: string;
  earned: number;
  balance: number;
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

export function firstNameOf(name: string): string {
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
