// A declined card, in plain words for the guest to take to their bank
// (the register's "Decline slip", pos/RecentDeclines.tsx). Pure: no
// imports, so scripts/test-decline-slip.mjs runs it straight with node.
// Customer-facing: no staff names, never "the Royale".

export const STATEMENT_DESCRIPTOR = "ROYALE CINEMA LOUNGE";

export interface DeclineInfo {
  chargeId: string; // ch_...
  at: string; // ISO, when it was declined
  amountCents: number;
  purpose: string; // "Insiders+ membership", "Purchase at the register"
  membership: boolean;
  brand: string | null; // "visa"
  last4: string | null;
  funding: string | null; // "debit" | "credit" | "prepaid"
  online: boolean; // card not present (online or a monthly charge), vs tapped/inserted here
  failureCode: string | null; // charge.failure_code, "card_declined"
  declineCode: string | null; // outcome.reason / decline_code, "do_not_honor"
  networkCode: string | null; // outcome.network_decline_code, "59"
  declinedBy: "bank" | "stripe"; // outcome.type issuer_declined vs blocked
  tappedOk: boolean; // this card was read fine in person here (a card saved from a tap)
}

// Stripe's decline codes (https://docs.stripe.com/declines/codes), in plain
// English. Anything unlisted gets the general line.
const REASONS: Record<string, string> = {
  do_not_honor: "Your bank declined this charge without giving a reason.",
  generic_decline: "Your bank declined this charge without giving a reason.",
  call_issuer: "Your bank declined this charge without giving a reason.",
  insufficient_funds: "Your bank says there wasn't enough money available.",
  withdrawal_count_limit_exceeded: "Your bank says the card is over its spending or use limit.",
  card_velocity_exceeded: "Your bank says the card is over its spending or use limit.",
  expired_card: "Your bank says the card has expired.",
  incorrect_cvc: "Your bank says the security code (CVC) didn't match.",
  invalid_cvc: "Your bank says the security code (CVC) didn't match.",
  incorrect_zip: "Your bank says the ZIP code didn't match.",
  incorrect_number: "Your bank says the card number didn't match.",
  invalid_number: "Your bank says the card number didn't match.",
  invalid_expiry_month: "Your bank says the expiration date didn't match.",
  invalid_expiry_year: "Your bank says the expiration date didn't match.",
  incorrect_pin: "Your bank says the PIN was wrong.",
  invalid_pin: "Your bank says the PIN was wrong.",
  pin_try_exceeded: "Too many wrong PIN tries. Your bank has paused PIN use on this card.",
  card_not_supported: "Your bank says this card can't be used for this kind of charge.",
  transaction_not_allowed: "Your bank doesn't allow this kind of charge on this card.",
  not_permitted: "Your bank doesn't allow this kind of charge on this card.",
  service_not_allowed: "Your bank doesn't allow this kind of charge on this card.",
  restricted_card: "Your bank has restricted this card.",
  pickup_card: "Your bank has restricted this card.",
  lost_card: "Your bank has the card marked as lost.",
  stolen_card: "Your bank has the card marked as stolen.",
  fraudulent: "Your bank flagged this charge as possible fraud.",
  security_violation: "Your bank flagged this charge as possible fraud.",
  stop_payment_order: "Your bank has a stop on payments to this business.",
  revocation_of_authorization: "Your bank has a stop on payments to this business.",
  revocation_of_all_authorizations: "Your bank has a stop on payments to this business.",
  currency_not_supported: "Your bank says this card can't pay in US dollars.",
  duplicate_transaction: "Your bank saw this as a repeat of a charge just made.",
  invalid_amount: "Your bank wouldn't accept this amount.",
  invalid_account: "Your bank says the card or account isn't valid.",
  new_account_information_available: "Your bank says the card or account isn't valid.",
  card_not_activated: "Your bank says this card hasn't been activated yet.",
  authentication_required: "Your bank wanted an extra check (like a code or app approval) that couldn't happen here.",
  approve_with_id: "Your bank couldn't approve the charge right now.",
  issuer_not_available: "Your bank couldn't be reached to approve the charge.",
  processing_error: "There was an error between the card network and your bank.",
  reenter_transaction: "There was an error between the card network and your bank.",
  try_again_later: "Your bank couldn't approve the charge right now.",
  testmode_decline: "A test card was used.",
};

export const GENERAL_REASON = "Your bank declined this charge.";

export function declineReason(declineCode: string | null, failureCode: string | null = null): string {
  return (declineCode && REASONS[declineCode]) || (failureCode && REASONS[failureCode]) || GENERAL_REASON;
}

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  american_express: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  interac: "Interac",
};

// "Visa debit ending 9225". Never more than the last four.
export function cardLine(brand: string | null, funding: string | null, last4: string | null): string {
  const b = brand ? (BRANDS[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1)) : "Card";
  const f = funding === "debit" || funding === "credit" || funding === "prepaid" ? ` ${funding}` : "";
  const l = last4 && /^\d{4}$/.test(last4) ? ` ending ${last4}` : "";
  return `${b}${f}${l}`;
}

export type SlipPart =
  | { kind: "title"; text: string }
  | { kind: "text"; text: string }
  | { kind: "pair"; left: string; right: string }
  | { kind: "head"; text: string }
  | { kind: "rule" }
  | { kind: "gap" };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// The slip, top to bottom. `when` is the printed date and time (America/Chicago).
export function declineSlipParts(d: DeclineInfo, when: string): SlipPart[] {
  const p: SlipPart[] = [];
  p.push({ kind: "title", text: "PAYMENT NOT APPROVED" });
  p.push({ kind: "text", text: when });
  p.push({ kind: "text", text: `Charge from: ${STATEMENT_DESCRIPTOR}` });
  p.push({ kind: "rule" });
  p.push({ kind: "pair", left: "Amount", right: dollars(d.amountCents) });
  p.push({ kind: "text", text: `For: ${d.purpose}` });
  p.push({ kind: "text", text: `Card: ${cardLine(d.brand, d.funding, d.last4)}` });
  p.push({
    kind: "text",
    text: d.online ? "How: online or monthly charge (card not present)" : "How: in person, card tapped or inserted here",
  });
  p.push({ kind: "rule" });
  p.push({ kind: "text", text: d.declinedBy === "bank" ? "Declined by: your card's bank" : "Declined by: our card processor's fraud check" });
  p.push({ kind: "text", text: `Reason: ${declineReason(d.declineCode, d.failureCode)}` });
  p.push({ kind: "gap" });
  p.push({ kind: "head", text: "For your bank:" });
  if (d.declineCode) p.push({ kind: "pair", left: "Decline code", right: d.declineCode });
  if (d.failureCode && d.failureCode !== d.declineCode) p.push({ kind: "pair", left: "Error", right: d.failureCode });
  if (d.networkCode) p.push({ kind: "pair", left: "Network code", right: d.networkCode });
  p.push({ kind: "text", text: `Reference: ${d.chargeId}` });
  p.push({ kind: "rule" });
  if (d.online) {
    p.push({
      kind: "text",
      text: d.tappedOk
        ? "This card worked when tapped in person here. Banks often block a first online or monthly charge from a new business, even when the tap went through."
        : "Banks often block a first online or monthly charge from a new business.",
    });
    p.push({ kind: "gap" });
  }
  p.push({ kind: "head", text: "What to do:" });
  p.push({ kind: "text", text: "1. Call the number on the back of your card, or approve the charge in your bank's app. Then try again." });
  p.push({ kind: "text", text: "2. Or use a different card." });
  if (d.membership) {
    p.push({ kind: "gap" });
    p.push({ kind: "text", text: "Your account is saved. Sign in at royalecinemajoplin.com to finish." });
  }
  return p;
}

// The slip as plain text (tests, and the register's on-screen preview).
export function declineSlipText(d: DeclineInfo, when: string, width = 48): string {
  return declineSlipParts(d, when)
    .map((x) => {
      if (x.kind === "rule") return "-".repeat(width);
      if (x.kind === "gap") return "";
      if (x.kind === "pair") return x.left.padEnd(Math.max(x.left.length + 1, width - x.right.length)) + x.right;
      return x.text;
    })
    .join("\n");
}
