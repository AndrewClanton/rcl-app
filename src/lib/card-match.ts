// Card-linked points: the rules, with no database or Stripe in them, so
// scripts/check-card-points.mjs can check them directly. The server side
// (reading the card from Stripe, saving links, paying points) is in
// lib/member-cards.ts.
//
// A card is recognized by Stripe's fingerprint for it: the same code every
// time the same card number pays us, and nothing that reveals the number.
// We keep it with the brand and last four digits, for showing "Visa ••••
// 4242". A phone or watch (Apple Pay and the like) is its own card: Stripe
// fingerprints the phone's number, not the card behind it.

// A register sale's Undo (and the other buttons on its card notice) works
// this long after the sale, on the register that rang it. After that, a
// manager can undo a card match from the member's page in Back office.
export const CARD_UNDO_MS = 2 * 60 * 1000;

// A card links to a member on its own only after it has paid for sales they
// were attached to on this many different business days. One sale isn't
// enough: whoever paid for a friend's or a teen's order would otherwise be
// linked to them.
export const LINK_AFTER_DAYS = 2;

// A member gets up to this many cards linked on their own. Past that, more
// aren't linked (someone attached to a lot of other people's sales
// shouldn't collect their cards). A manager can still link one in Back
// office, up to the same number.
export const MAX_AUTO_LINKED_CARDS = 4;

// The note on the points taken back by an Undo (undo_card_sale and
// undo_card_booking in migration 20261001100000). The member's points
// history shows it as "Taken back: this purchase wasn't yours".
export const CARD_UNDO_NOTE = "Card match undone";

export interface SaleCard {
  fingerprint: string;
  livemode: boolean;
  brand: string | null;
  last4: string | null;
  wallet: string | null; // apple_pay, google_pay, ...; null for the card itself
}

// Just the parts of a Stripe charge this reads.
interface CardDetails {
  fingerprint?: string | null;
  brand?: string | null;
  last4?: string | null;
  wallet?: { type?: string | null } | null;
}
export interface ChargeLike {
  livemode?: boolean;
  payment_method_details?: {
    type?: string | null;
    card_present?: CardDetails | null;
    interac_present?: CardDetails | null;
    card?: CardDetails | null;
  } | null;
}

function cleanLast4(v: string | null | undefined): string | null {
  return v && /^[0-9]{4}$/.test(v) ? v : null;
}

function cleanWallet(v: string | null | undefined): string | null {
  return v && /^[a-z_]{1,40}$/.test(v) ? v : null;
}

// The card a charge was paid with, or null when there's nothing to go on
// (not a card, or Stripe gave no fingerprint). A tap or insert on the
// reader is card_present; a tab's saved card and online payments are card.
export function cardFromCharge(charge: ChargeLike | null | undefined): SaleCard | null {
  const d = charge?.payment_method_details;
  if (!d || typeof charge?.livemode !== "boolean") return null;
  const found = d.card_present ?? d.interac_present ?? d.card ?? null;
  const fingerprint = found?.fingerprint;
  if (!found || typeof fingerprint !== "string" || !fingerprint) return null;
  return {
    fingerprint,
    livemode: charge.livemode,
    brand: found.brand ? String(found.brand).toLowerCase() : null,
    last4: cleanLast4(found.last4),
    wallet: cleanWallet(found.wallet?.type ?? null),
  };
}

// The register's payments carry metadata.source "pos" (a tap or insert on
// the reader) or "pos-tab" (a tab's card on file). A payment id sent by a
// register is only read for its card if it's one of those, for the amount
// the sale says was paid by card: never an online booking, a membership
// bill or someone else's payment.
export const REGISTER_PAYMENT_SOURCES = ["pos", "pos-tab"];

export function isRegisterPayment(pi: { status?: string | null; metadata?: Record<string, string> | null; amount_received?: number | null }, cardAmount: number | null | undefined): boolean {
  if (pi.status !== "succeeded") return false;
  if (!REGISTER_PAYMENT_SOURCES.includes(pi.metadata?.source ?? "")) return false;
  const want = Math.round(Number(cardAmount ?? NaN) * 100);
  return Number.isFinite(want) && want > 0 && pi.amount_received === want;
}

const WALLET_NAMES: Record<string, string> = { apple_pay: "Apple Pay", google_pay: "Google Pay", samsung_pay: "Samsung Pay", unknown: "Phone wallet" };
const BRAND_NAMES: Record<string, string> = { amex: "Amex", american_express: "Amex", mastercard: "Mastercard", visa: "Visa", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

// What the card is called on screen: "Visa", "Apple Pay", or "Card". Stripe
// Link is only how an online card was saved, so it shows as the card.
export function cardName(card: { brand: string | null; wallet: string | null }): string {
  if (card.wallet && card.wallet !== "link") return WALLET_NAMES[card.wallet] ?? "Phone wallet";
  if (!card.brand || card.brand === "unknown") return "Card";
  return BRAND_NAMES[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
}

// "Visa •••• 4242", "Apple Pay •••• 1234", or just "Visa".
export function cardLabel(card: { brand: string | null; last4: string | null; wallet: string | null }): string {
  return card.last4 ? `${cardName(card)} •••• ${card.last4}` : cardName(card);
}

// The notes on points a card paid. No card digits: if it turns out the card
// wasn't theirs, their points history mustn't show someone else's card.
export type CreditHow = "card" | "picked" | "given";
export function saleCreditNote(orderNumber: number, how: CreditHow): string {
  return how === "given" ? `Order #${orderNumber}, given to you at the register` : `Order #${orderNumber}, paid with a card linked to your account`;
}
export function bookingCreditNote(quantity: number): string {
  return `${quantity} ticket${quantity === 1 ? "" : "s"} bought online, paid with a card linked to your account`;
}

export function firstName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n.split(/\s+/)[0] || "Member";
}

// "Sarah R.": enough to tell two people apart at the register.
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : parts[0];
}

// ---------- the matching rule ----------

// Every member_cards row for the card's fingerprint (any mode, removed or
// not), with what matters about its member.
export interface CardLinkRow {
  memberId: string;
  livemode: boolean;
  removed: boolean;
  memberErased: boolean;
  memberLinksCards: boolean; // members.link_cards (their own switch)
  linkedOrderId: string | null;
}

export interface SaleForMatch {
  orderId: string;
  status: string;
  memberId: string | null;
  memberSource: string | null;
  // A card match on this sale was undone: it isn't matched again.
  undone: boolean;
}

// The member staff attached to the sale, when there is one.
export interface AttachedMember {
  erased: boolean;
  linksCards: boolean;
  activeCards: number; // cards linked to them now (not removed), in this mode
  // The cashier's own account (a staff login is also a member). Their card
  // is linked only by a manager in Back office.
  isCashier: boolean;
  // Different business days this card paid for a sale they were attached
  // to, this one included.
  daysWithCard: number;
  // They paid it themselves, signed in (online tickets, or an Insiders+
  // checkout they or staff started for them): no second day needed.
  selfPaid: boolean;
}

export type CardDecision =
  | { kind: "skip"; why: string }
  // Credited by the card already (a retried save): show it again.
  | { kind: "already_credited"; memberId: string }
  // This sale is what linked the card (a retried save): show it again.
  | { kind: "linked_here"; memberId: string }
  // Already theirs: just note it was used.
  | { kind: "used"; memberId: string }
  | { kind: "link"; memberId: string }
  | { kind: "attach"; memberId: string }
  // On more than one account (a shared family card): ask who.
  | { kind: "choose"; memberIds: string[] };

// Who can be found by this card: members with a link that isn't removed,
// in the same mode (test or live), who haven't been removed themselves and
// haven't turned linking off.
export function cardOwners(card: { livemode: boolean }, links: CardLinkRow[]): string[] {
  const ids = links.filter((l) => l.livemode === card.livemode && !l.removed && !l.memberErased && l.memberLinksCards).map((l) => l.memberId);
  return [...new Set(ids)];
}

// What to do with a paid card sale.
//  - With a member attached (by staff): link the card to them once it has
//    paid for their sales on 2 different days, unless they removed it
//    before, they have enough cards, it's the cashier's own account, or
//    it's already someone else's (a manager can link those in Back
//    office). The sale's points were already paid to them; nothing moves.
//  - With nobody attached: one member owns the card, so the points are
//    theirs. Two or more, nobody gets them automatically: the cashier asks.
export function decideCardOutcome(sale: SaleForMatch, card: { livemode: boolean }, links: CardLinkRow[], attached: AttachedMember | null): CardDecision {
  if (sale.status !== "completed") return { kind: "skip", why: "not a completed sale" };
  const owners = cardOwners(card, links);

  if (sale.memberId) {
    const memberId = sale.memberId;
    if (sale.memberSource) return { kind: "already_credited", memberId };
    if (!attached || attached.erased) return { kind: "skip", why: "member removed" };
    const mine = links.find((l) => l.memberId === memberId && l.livemode === card.livemode) ?? null;
    if (mine?.removed) return { kind: "skip", why: "removed before" };
    if (mine) return mine.linkedOrderId && mine.linkedOrderId === sale.orderId ? { kind: "linked_here", memberId } : { kind: "used", memberId };
    if (!attached.linksCards) return { kind: "skip", why: "linking turned off" };
    if (attached.activeCards >= MAX_AUTO_LINKED_CARDS) return { kind: "skip", why: "enough cards" };
    if (attached.isCashier) return { kind: "skip", why: "the cashier's own account" };
    if (owners.some((id) => id !== memberId)) return { kind: "skip", why: "someone else's card" };
    if (!attached.selfPaid && attached.daysWithCard < LINK_AFTER_DAYS) return { kind: "skip", why: "not on another day yet" };
    return { kind: "link", memberId };
  }

  if (sale.undone) return { kind: "skip", why: "undone" };
  if (owners.length === 1) return { kind: "attach", memberId: owners[0] };
  if (owners.length > 1) return { kind: "choose", memberIds: owners };
  return { kind: "skip", why: "no one has this card" };
}

// ---------- what the register shows ----------

export interface NoticeCandidate {
  id: string;
  name: string; // "Sarah R."
}

interface NoticeBase {
  orderId: string;
  orderNumber: number;
  label: string; // "Visa •••• 4242"
  // Proves this register rang the sale, for the buttons below; null when
  // the time for them has passed. `ttlMs`: how long the buttons have left,
  // counted from when the register gets this (not a clock time, so a
  // register whose clock is off still gets the full time).
  token: string | null;
  ttlMs: number | null;
}

export type CardNotice =
  // The card's member got the points (how: the card found them, the
  // cashier picked them for a shared card, or gave them after an undo).
  | (NoticeBase & { kind: "matched"; firstName: string; points: number; how: CreditHow })
  | (NoticeBase & { kind: "linked"; firstName: string })
  | (NoticeBase & { kind: "choose"; points: number; candidates: NoticeCandidate[] })
  // Taken back (taken: the points; unlinked: the card came off their
  // account too). Give the sale's points to someone else? candidates: the
  // card's other members, if it's shared.
  | (NoticeBase & { kind: "undone"; firstName: string; taken: number; unlinked: boolean; points: number; candidates: NoticeCandidate[] });

// "Sarah R.", "Sarah R. and Mike T.", "Sarah R., Mike T. and Ana P."
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function pointsText(n: number): string {
  const p = Math.round(n);
  return `${p} point${p === 1 ? "" : "s"}`;
}
