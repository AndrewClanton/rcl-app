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
  // Who's checked in on this order: first name only, for the live tally.
  member?: { firstName: string; points: number; plus: boolean } | null;
  pointsToEarn?: number;
}

export const EMPTY_CART_SNAPSHOT: RegisterCartSnapshot = { orderName: "", items: [], subtotal: 0, tax: 0, total: 0 };
