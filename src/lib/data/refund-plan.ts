// The arithmetic behind a partial refund (Reports, "Refund part", in
// src/app/admin/reports/actions.ts), kept apart so it can be checked on its
// own and shared with the Orders table, which shows the most that can go
// back: how much may go back, how much of it is sales tax, and how it
// splits between the card and the drawer. No database, no Stripe here.

export interface RefundableOrder {
  source: string; // 'pos' | 'web'
  tax: number;
  tip: number;
  total: number; // includes tax and tip
  cash: number; // payment_cash_amount
  card: number; // payment_card_amount (tip included)
}

export interface EarlierRefunds {
  amount: number;
  tax: number;
  card: number;
}

export type RefundPlan =
  | { ok: true; amount: number; tax: number; toCard: number; toCash: number; share: number }
  | { ok: false; most: number };

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// The most a partial refund can give back now: what was paid in cash or on
// a card for the goods (tax in, tip out; paper vouchers aren't money), less
// what earlier partial refunds gave back. A web order was paid online in
// full.
export function mostRefundable(order: RefundableOrder, earlier: EarlierRefunds): number {
  const goods = round2(order.total - order.tip);
  const paid = order.source === "pos" ? order.cash + order.card : goods;
  return Math.max(0, round2(Math.min(goods, paid) - earlier.amount));
}

// Card first, up to what's left on it, then cash. The tax inside the
// amount is the order's tax in proportion, never more than is left.
// `share` is the part of the order's goods this is, for points.
export function planPartialRefund(order: RefundableOrder, earlier: EarlierRefunds, amountIn: number): RefundPlan {
  const amount = round2(amountIn);
  const most = mostRefundable(order, earlier);
  if (!(amount > 0) || amount > most) return { ok: false, most };
  const goods = round2(order.total - order.tip);
  const cardPaid = order.source === "pos" ? order.card : goods;
  const toCard = round2(Math.min(amount, Math.max(0, cardPaid - earlier.card)));
  const toCash = round2(amount - toCard);
  const tax = goods > 0 ? Math.max(0, round2(Math.min(amount * (order.tax / goods), order.tax - earlier.tax))) : 0;
  return { ok: true, amount, tax, toCard, toCash, share: goods > 0 ? amount / goods : 0 };
}
