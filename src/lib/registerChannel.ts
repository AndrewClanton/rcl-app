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
