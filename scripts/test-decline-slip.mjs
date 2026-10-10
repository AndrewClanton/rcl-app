// node --test scripts/test-decline-slip.mjs
// The decline slip's code-to-words mapping and layout (src/lib/decline-slip.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { declineReason, cardLine, declineSlipText, GENERAL_REASON } from "../src/lib/decline-slip.ts";

test("decline codes map to plain words", () => {
  assert.equal(declineReason("do_not_honor"), "Your bank declined this charge without giving a reason.");
  assert.match(declineReason("insufficient_funds"), /enough money/);
  assert.match(declineReason("expired_card"), /expired/);
  assert.match(declineReason("incorrect_cvc"), /security code/);
  assert.match(declineReason("card_not_supported"), /can't be used/);
  assert.match(declineReason("transaction_not_allowed"), /doesn't allow/);
  assert.match(declineReason(null, "expired_card"), /expired/);
  assert.equal(declineReason("something_new", "card_declined"), GENERAL_REASON);
  assert.equal(declineReason(null, null), GENERAL_REASON);
});

test("card line never shows more than the last four", () => {
  assert.equal(cardLine("visa", "debit", "9225"), "Visa debit ending 9225");
  assert.equal(cardLine("amex", "credit", null), "American Express credit");
  assert.equal(cardLine(null, "unknown", "4242424242424242"), "Card");
});

const example = {
  chargeId: "ch_3TEST",
  at: "2026-10-09T23:42:00Z",
  amountCents: 1087,
  purpose: "Insiders+ membership",
  membership: true,
  brand: "visa",
  last4: "9225",
  funding: "debit",
  online: true,
  failureCode: "card_declined",
  declineCode: "do_not_honor",
  networkCode: "59",
  declinedBy: "bank",
  tappedOk: true,
};

test("slip for an online membership decline", () => {
  const t = declineSlipText(example, "Oct 9, 2026, 6:42 PM");
  for (const s of [
    "PAYMENT NOT APPROVED",
    "Charge from: ROYALE CINEMA LOUNGE",
    "$10.87",
    "Card: Visa debit ending 9225",
    "online or monthly charge",
    "Declined by: your card's bank",
    "without giving a reason",
    "do_not_honor",
    "Network code",
    "Reference: ch_3TEST",
    "worked when tapped in person",
    "Call the number on the back of your card",
    "different card",
    "Sign in at royalecinemajoplin.com to finish",
  ])
    assert.ok(t.includes(s), `missing: ${s}\n${t}`);
  assert.ok(!/the Royale/i.test(t));
  assert.ok(!t.includes("4242"));
});

test("slip for a reader decline: no membership line, no online note", () => {
  const t = declineSlipText({ ...example, membership: false, online: false, purpose: "Purchase at the register", tappedOk: false }, "x");
  assert.ok(t.includes("in person, card tapped or inserted"));
  assert.ok(!t.includes("royalecinemajoplin.com"));
  assert.ok(!t.includes("first online"));
});
