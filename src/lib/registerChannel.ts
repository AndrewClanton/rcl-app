// Shared between the POS (sender) and the customer-facing kiosk display
// (receiver): a Supabase Realtime broadcast channel, deliberately NOT
// backed by a database table. An in-progress cart isn't persisted anywhere
// until it's held, tabbed, or completed, so mirroring it live has to be
// pure pub/sub rather than routing through payment-critical order rows.
export const REGISTER_CHANNEL = "register:main";

export interface RegisterCartSnapshot {
  orderName: string;
  items: { name: string; quantity: number; modifiers: string[] }[];
  subtotal: number;
  tax: number;
  total: number;
}

export const EMPTY_CART_SNAPSHOT: RegisterCartSnapshot = { orderName: "", items: [], subtotal: 0, tax: 0, total: 0 };
