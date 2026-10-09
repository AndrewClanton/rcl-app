// Past card purchases (Fortis): the per-card grant rules, with no database
// or Stripe in them, so scripts can import them. The database side is
// grant_fortis_card (migration 20261009120000), which checks the same
// rules again under its lock.
//
//   - One grant per card: 1 point per $1 of what the card spent, net of
//     refunds, rounded down. A one-time backfill: no daily earning cap.
//   - Paid without anyone looking only when the match is high confidence
//     (an email or phone on the payment, or the whole name on the card
//     agreeing with exactly one member) and the member's past-purchase
//     points stay at 1,000 or under. Everything else waits in Back office's
//     Needs approval for a manager.

import { normalizeName, middlesFit } from "@/lib/fortis-backfill";

export const APPROVAL_OVER = 1000;

// The points-history note (grant_fortis_card writes it):
// "Past purchases (old register): $123.45".
export const PAST_PURCHASE_NOTE_PREFIX = "Past purchases (old register)";

export function pastPurchasePoints(netTotal: number): number {
  // The epsilon keeps $10.00 stored as 9.9999999 from losing a point.
  return Math.max(0, Math.floor(Number(netTotal) + 1e-9));
}

// A match strong enough to pay without a person looking.
export const AUTO_KINDS = ["email", "phone", "name"] as const;

export interface CardForRule {
  match_status: string;
  match_kind: string | null;
  match_confidence: string | null;
  decision: string;
  matched_member_id: string | null;
  granted_at: string | null;
  erased_at: string | null;
  net_total: number | string;
}

export function highConfidence(c: CardForRule): boolean {
  return (
    c.match_status === "matched" &&
    !!c.matched_member_id &&
    c.match_confidence === "high" &&
    (AUTO_KINDS as readonly string[]).includes(c.match_kind ?? "") &&
    c.decision !== "skipped"
  );
}

// Within the line: this card, and the member's past-purchase points with it.
export function withinLine(points: number, alreadyGranted: number): boolean {
  return points <= APPROVAL_OVER && alreadyGranted + points <= APPROVAL_OVER;
}

// Why a card is waiting for a manager (null: it isn't).
export type QueueReason = "over" | "pick" | "low" | "register" | "approved";

export function queueReason(c: CardForRule, alreadyGranted: number): QueueReason | null {
  if (c.granted_at || c.erased_at || c.decision === "skipped") return null;
  if (c.match_status === "needs_pick") return "pick";
  if (c.match_status !== "matched" || !c.matched_member_id) return null;
  const points = pastPurchasePoints(Number(c.net_total));
  if (!withinLine(points, alreadyGranted)) return "over";
  if (highConfidence(c)) return null; // the automatic run pays these
  if (c.match_kind === "register") return "register";
  if (c.decision === "approved") return "approved";
  return "low";
}

export const QUEUE_REASON_TEXT: Record<QueueReason, string> = {
  over: "Over 1,000 points",
  pick: "More than one member fits",
  low: "Name close, not exact",
  register: "Claimed at the register",
  approved: "Approved, not paid yet",
};

// ---------- the register ----------

// Stripe's brand names to the old register's.
const STRIPE_TO_FORTIS: Record<string, string> = { visa: "visa", mastercard: "mc", amex: "amex", american_express: "amex", discover: "disc" };
const FORTIS_BRAND_NAME: Record<string, string> = { visa: "Visa", mc: "Mastercard", amex: "Amex", disc: "Discover" };

export function fortisBrand(stripeBrand: string | null | undefined): string | null {
  return STRIPE_TO_FORTIS[String(stripeBrand ?? "").toLowerCase()] ?? null;
}

export function fortisBrandName(brand: string | null | undefined): string {
  return FORTIS_BRAND_NAME[String(brand ?? "")] ?? "Card";
}

// Does the name on today's card fit an old card's names? null: there's
// nothing to compare (no name on one side), so last 4 + brand decide.
export function nameFits(cardholderName: string | null | undefined, card: { name_keys: string[] | null; name_fulls: string[] | null }): boolean | null {
  const n = normalizeName(cardholderName);
  const keys = card.name_keys ?? [];
  if (!n.key || !keys.length) return null;
  if (!keys.includes(n.key)) return false;
  const fulls = (card.name_fulls ?? []).filter((f) => f.split(" ")[0] + " " + f.split(" ").slice(-1)[0] === n.key);
  return !fulls.length || fulls.some((f) => middlesFit(f, n.full ?? n.key!));
}

// Of the old cards with the same last 4 and brand, the one to offer: a
// single one whose name fits (or that has no name to compare). Two or more
// that fit: none (the register can't tell them apart).
export function pickOldCard<T extends { name_keys: string[] | null; name_fulls: string[] | null }>(cards: T[], cardholderName: string | null | undefined): T | null {
  const fits = cards.map((c) => ({ c, fit: nameFits(cardholderName, c) })).filter((x) => x.fit !== false);
  const named = fits.filter((x) => x.fit === true);
  if (named.length === 1) return named[0].c;
  if (named.length > 1) return null;
  return fits.length === 1 ? fits[0].c : null;
}

// "Mar 2025".
export function monthShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" });
}

// What the register shows: no names but the member's own first name.
export interface OldCardOffer {
  token: string;
  ttlMs: number;
  orderId: string;
  orderNumber: number;
  cardId: string;
  lastFour: string;
  brand: string; // "Visa"
  visits: number;
  since: string; // "Mar 2025"
  until: string;
  points: number;
  needsApproval: boolean;
  firstName: string;
}
