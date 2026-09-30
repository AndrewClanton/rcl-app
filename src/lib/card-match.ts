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

// A member attached to card sales gets up to this many cards linked on
// their own. Past that, more aren't linked (someone attached to a lot of
// other people's sales shouldn't collect their cards).
export const MAX_AUTO_LINKED_CARDS = 4;

// The note on the points taken back by an Undo (undo_card_match in
// migration 20261001100000). The member's points history shows it as
// "Taken back: not your card".
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

// For the note on the points: "matched by card ending 4242", or "matched by
// Apple Pay ending 1234" for a phone.
export function matchedByNote(card: { last4: string | null; wallet: string | null }): string {
  const what = card.wallet && card.wallet !== "link" ? (WALLET_NAMES[card.wallet] ?? "phone wallet") : "card";
  return card.last4 ? `matched by ${what} ending ${card.last4}` : `matched by ${what}`;
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
}

// The member staff attached to the sale, when there is one.
export interface AttachedMember {
  erased: boolean;
  linksCards: boolean;
  activeCards: number; // cards linked to them now (not removed), in this mode
  isCashier: boolean; // the cashier's own account (a staff login is also a member)
}

export type CardDecision =
  | { kind: "skip"; why: string }
  // Found by this card already (a retried save): show it again.
  | { kind: "already_matched"; memberId: string }
  // This sale is what linked the card (a retried save): show it again.
  | { kind: "linked_here"; memberId: string }
  // Already theirs: just note it was used.
  | { kind: "used"; memberId: string }
  | { kind: "link"; memberId: string }
  // The cashier's own account: ask instead of linking.
  | { kind: "offer_self"; memberId: string }
  // Already linked to someone else (a family card): ask before sharing it,
  // since a shared card never finds anyone on its own.
  | { kind: "offer_shared"; memberId: string; ownerIds: string[] }
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
//  - With a member attached (by staff): link the card to them, unless
//    they removed it before, it's the cashier's own account (asked
//    instead), it's already someone else's (asked whether to share it;
//    until then it stays theirs alone), or they already have enough cards.
//    The sale's points were already paid to them; nothing moves.
//  - With nobody attached: one member owns the card, so the sale is
//    theirs. Two or more, nobody gets it automatically.
export function decideCardOutcome(sale: SaleForMatch, card: { livemode: boolean }, links: CardLinkRow[], attached: AttachedMember | null): CardDecision {
  if (sale.status !== "completed") return { kind: "skip", why: "not a completed sale" };
  const owners = cardOwners(card, links);

  if (sale.memberId) {
    const memberId = sale.memberId;
    if (sale.memberSource === "card") return { kind: "already_matched", memberId };
    if (!attached || attached.erased) return { kind: "skip", why: "member removed" };
    const mine = links.find((l) => l.memberId === memberId && l.livemode === card.livemode) ?? null;
    if (mine?.removed) return { kind: "skip", why: "removed before" };
    if (mine) return mine.linkedOrderId === sale.orderId ? { kind: "linked_here", memberId } : { kind: "used", memberId };
    if (!attached.linksCards) return { kind: "skip", why: "linking turned off" };
    const others = owners.filter((id) => id !== memberId);
    // A cashier on their own account isn't offered someone else's card.
    if (others.length && attached.isCashier) return { kind: "skip", why: "someone else's card" };
    if (!others.length && attached.isCashier) return { kind: "offer_self", memberId };
    if (attached.activeCards >= MAX_AUTO_LINKED_CARDS) return { kind: "skip", why: "enough cards" };
    if (others.length) return { kind: "offer_shared", memberId, ownerIds: others };
    return { kind: "link", memberId };
  }

  if (owners.length === 1) return { kind: "attach", memberId: owners[0] };
  if (owners.length > 1) return { kind: "choose", memberIds: owners };
  return { kind: "skip", why: "no one has this card" };
}

// ---------- what the register shows ----------

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
  | (NoticeBase & { kind: "matched"; firstName: string; points: number })
  | (NoticeBase & { kind: "linked"; firstName: string })
  | (NoticeBase & { kind: "choose"; points: number; candidates: { id: string; name: string }[] })
  | (NoticeBase & { kind: "self"; firstName: string })
  // Someone else's card: link it to this member too? ownerNames: "Sarah R."
  | (NoticeBase & { kind: "shared"; firstName: string; ownerNames: string[] });

// "Sarah R.", "Sarah R. and Mike T.", "Sarah R., Mike T. and Ana P."
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function pointsText(n: number): string {
  const p = Math.round(n);
  return `${p} point${p === 1 ? "" : "s"}`;
}
