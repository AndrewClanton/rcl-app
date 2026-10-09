// Gift cards: sold on the register (the Gift card button), spent on the
// register (the Gift card way to pay), kept in gift_cards with every change
// in gift_card_transactions (migration 20261009120000_gift_cards.sql).
// No server imports: the register uses this too.
//
// How they work:
// - Selling one: a "Gift card" line on the order (isGiftCardLine in
//   lib/register-totals.ts). It's untaxed, gets no discounts and earns no
//   points, with no manager PIN. The card and its code are made once the
//   sale saves (completeOrder), printed on the receipt and on a slip.
// - Spending one: the payment screen's Gift card button. Staff type or scan
//   the code, see the balance, and use up to what's left to pay; card or
//   cash pays the rest. Because it's a way to pay, the order is taxed like
//   any other: tax applies to what the card is spent on.
// - The balance comes off in one step on the server with the card locked
//   (redeem_gift_card), so it can't be spent twice or go below zero.
// - Refunding an order puts back what gift cards paid, and voids any card
//   the order sold (refund_order_gift_cards).
// - Back office -> Gift cards: every card, its history, and a manager's
//   adjustment (with a reason).

// What the code is made of: no 0/O, no 1/I/L.
export const GIFT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// The amounts the register offers, and the most one card can hold.
export const GIFT_CARD_PRESETS = [25, 50, 100] as const;
export const GIFT_CARD_MAX = 1000;
export const GIFT_CARD_MIN = 1;

// The name a sold card's line goes by (isGiftCardLine knows it).
export const GIFT_CARD_LINE_NAME = "Gift card";

const CODE_RE = new RegExp(`^RCL-[${GIFT_CODE_ALPHABET}]{4}-[${GIFT_CODE_ALPHABET}]{4}$`);

export function isGiftCode(s: string): boolean {
  return CODE_RE.test(s);
}

// What staff typed or scanned, as a code: any case, spaces or dashes, with
// or without "RCL". Null when it can't be one.
export function normalizeGiftCode(input: string): string | null {
  const raw = String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("RCL") && raw.length === 11 ? raw.slice(3) : raw;
  if (body.length !== 8) return null;
  const code = `RCL-${body.slice(0, 4)}-${body.slice(4)}`;
  return isGiftCode(code) ? code : null;
}

// The last four, for a receipt's payment line and anywhere the whole code
// shouldn't show.
export function giftCodeTail(code: string): string {
  return code.slice(-4);
}

// A new code from 8 random numbers (crypto random, 0-255 each; the server
// passes them in).
export function giftCodeFrom(bytes: ArrayLike<number>): string {
  const n = GIFT_CODE_ALPHABET.length;
  const chars: string[] = [];
  // Rejection sampling: only bytes under the largest multiple of n, so
  // every letter is equally likely.
  const limit = 256 - (256 % n);
  for (let i = 0; i < bytes.length && chars.length < 8; i++) if (bytes[i] < limit) chars.push(GIFT_CODE_ALPHABET[bytes[i] % n]);
  if (chars.length < 8) throw new Error("not enough random bytes");
  return `RCL-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// A gift card amount staff entered: whole cents, within the limits.
export function giftAmountProblem(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount.";
  if (amount < GIFT_CARD_MIN) return `A gift card is at least $${GIFT_CARD_MIN}.`;
  if (amount > GIFT_CARD_MAX) return `A gift card holds at most $${GIFT_CARD_MAX.toLocaleString("en-US")}.`;
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return "Whole cents only.";
  return null;
}

// A gift card paying for an order (CheckoutPayment.giftCard). key: made on
// the register when the card is applied, so a retry of the same sale takes
// the money once.
export interface GiftCardTender {
  code: string;
  amount: number;
  key: string;
  // The balance the register saw, for the screen and the receipt only.
  balanceBefore?: number;
}

// A card sold on a sale, as completeOrder hands it back for printing.
export interface IssuedGiftCard {
  code: string;
  amount: number;
  member: string | null;
}

export type GiftTxKind = "issue" | "redeem" | "refund" | "adjust" | "void";

export const GIFT_TX_LABEL: Record<GiftTxKind, string> = {
  issue: "Sold",
  redeem: "Spent",
  refund: "Put back",
  adjust: "Adjusted",
  void: "Voided",
};

// Why redeem_gift_card said no, in the cashier's words.
export function giftRedeemError(why: string | undefined, balance?: number | null): string {
  const left = typeof balance === "number" ? ` It has $${Number(balance).toFixed(2)} on it.` : "";
  switch (why) {
    case "not_found":
      return "No gift card has that code. Check it and try again.";
    case "void":
      return "That gift card was voided, so it can't be used.";
    case "short":
      return `That gift card doesn't have enough left for this.${left} Use what's on it and take the rest another way.`;
    case "used_key":
      return "That gift card payment was put back after the sale didn't save. Take payment again.";
    case "missing":
      return "Gift cards need a database update first (supabase/migrations/20261009120000_gift_cards.sql). Take payment another way.";
    default:
      return "The gift card couldn't be checked. Take payment another way, or try again.";
  }
}
