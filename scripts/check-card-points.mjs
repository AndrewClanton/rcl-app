// Checks the card-linked points rules without a database or Stripe:
//  1. Reading the card from a Stripe charge (lib/card-match.ts
//     cardFromCharge): a tap or insert, a phone wallet, a tab's saved card,
//     Stripe Link and other non-cards, a missing fingerprint, test mode.
//  2. What staff and members see: "Visa •••• 4242", the points note, names;
//     and that the copies in the migration and the backfill dry run match.
//  3. The matching rule (decideCardOutcome): nobody, one or two members on a
//     card, a removed link, a removed member, linking switched off, test
//     cards against live ones, the cashier's own account, too many cards,
//     someone else's card (asked before it's shared), a retried save,
//     refunded and voided sales.
//  4. The register's 2-minute buttons (noticeTiming in lib/member-cards.ts):
//     the token works for that sale and that register login only, and not
//     after the 2 minutes. Uses a made-up signing key, nothing real.
//
// Usage: node scripts/check-card-points.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { readFile } from "node:fs/promises";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);

const m = await import("../src/lib/card-match.ts");
const { cardFromCharge, cardLabel, cardName, matchedByNote, firstName, shortName, nameList, decideCardOutcome, cardOwners, pointsText, CARD_UNDO_MS, MAX_AUTO_LINKED_CARDS, CARD_UNDO_NOTE } = m;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---------- 1. the card on a charge ----------
const tap = { livemode: true, payment_method_details: { type: "card_present", card_present: { fingerprint: "fpPlastic", brand: "visa", last4: "4242", wallet: null } } };
eq("a tap on the reader", cardFromCharge(tap), { fingerprint: "fpPlastic", livemode: true, brand: "visa", last4: "4242", wallet: null });
const phone = { livemode: true, payment_method_details: { type: "card_present", card_present: { fingerprint: "fpPhone", brand: "mastercard", last4: "1234", wallet: { type: "apple_pay" } } } };
eq("Apple Pay on the reader is its own card", cardFromCharge(phone), { fingerprint: "fpPhone", livemode: true, brand: "mastercard", last4: "1234", wallet: "apple_pay" });
const tab = { livemode: true, payment_method_details: { type: "card", card: { fingerprint: "fpPlastic", brand: "visa", last4: "4242", wallet: null } } };
eq("a tab's saved card (card on file)", cardFromCharge(tab), { fingerprint: "fpPlastic", livemode: true, brand: "visa", last4: "4242", wallet: null });
const interac = { livemode: true, payment_method_details: { type: "interac_present", interac_present: { fingerprint: "fpInterac", brand: "interac", last4: "9999" } } };
eq("Interac on the reader (Canada only) still reads", cardFromCharge(interac)?.fingerprint, "fpInterac");
eq("Stripe Link (not a card) is skipped", cardFromCharge({ livemode: true, payment_method_details: { type: "link", link: { email: "x" } } }), null);
eq("Cash App (not a card) is skipped", cardFromCharge({ livemode: true, payment_method_details: { type: "cashapp", cashapp: {} } }), null);
eq("no fingerprint: nothing to match on", cardFromCharge({ livemode: true, payment_method_details: { type: "card_present", card_present: { fingerprint: null, brand: "visa", last4: "4242" } } }), null);
eq("empty fingerprint: nothing to match on", cardFromCharge({ livemode: true, payment_method_details: { type: "card", card: { fingerprint: "", brand: "visa", last4: "4242" } } }), null);
eq("no payment details", cardFromCharge({ livemode: true, payment_method_details: null }), null);
eq("no charge at all", cardFromCharge(null), null);
eq("unknown mode (no livemode): skipped", cardFromCharge({ payment_method_details: tap.payment_method_details }), null);
eq("a test-mode charge says so", cardFromCharge({ ...tap, livemode: false })?.livemode, false);
eq("an odd last four is dropped, never stored", cardFromCharge({ livemode: true, payment_method_details: { type: "card", card: { fingerprint: "fpX", brand: "visa", last4: "42x2" } } })?.last4, null);
eq("an odd wallet name is dropped", cardFromCharge({ livemode: true, payment_method_details: { type: "card", card: { fingerprint: "fpX", brand: "visa", last4: "4242", wallet: { type: "Apple Pay!" } } } })?.wallet, null);
eq("brand is kept lower case", cardFromCharge({ livemode: true, payment_method_details: { type: "card", card: { fingerprint: "fpX", brand: "Visa", last4: "4242" } } })?.brand, "visa");

// ---------- 2. what people see ----------
eq("label: Visa •••• 4242", cardLabel({ brand: "visa", last4: "4242", wallet: null }), "Visa •••• 4242");
eq("label: Apple Pay •••• 1234", cardLabel({ brand: "mastercard", last4: "1234", wallet: "apple_pay" }), "Apple Pay •••• 1234");
eq("label: Google Pay", cardLabel({ brand: "visa", last4: "5555", wallet: "google_pay" }), "Google Pay •••• 5555");
eq("label: an unknown phone wallet", cardLabel({ brand: "visa", last4: "5555", wallet: "unknown" }), "Phone wallet •••• 5555");
eq("label: Link shows the card itself", cardLabel({ brand: "visa", last4: "4242", wallet: "link" }), "Visa •••• 4242");
eq("label: Amex", cardLabel({ brand: "amex", last4: "0005", wallet: null }), "Amex •••• 0005");
eq("label: no last four", cardLabel({ brand: "discover", last4: null, wallet: null }), "Discover");
eq("label: nothing known", cardLabel({ brand: null, last4: null, wallet: null }), "Card");
eq("label: a brand we don't list", cardLabel({ brand: "eftpos_au", last4: "1111", wallet: null }), "Eftpos_au •••• 1111");
eq("card name for a phone", cardName({ brand: "visa", wallet: "samsung_pay" }), "Samsung Pay");
eq("points note for a card", matchedByNote({ last4: "4242", wallet: null }), "matched by card ending 4242");
eq("points note for a phone", matchedByNote({ last4: "1234", wallet: "apple_pay" }), "matched by Apple Pay ending 1234");
eq("points note with no last four", matchedByNote({ last4: null, wallet: null }), "matched by card");
eq("first name", firstName("  Sarah Jane Rogers "), "Sarah");
eq("first name, none", firstName(""), "Member");
eq("short name", shortName("Sarah Jane rogers"), "Sarah R.");
eq("short name, one word", shortName("Cher"), "Cher");
eq("1 point", pointsText(1), "1 point");
eq("23 points (rounded)", pointsText(23.4), "23 points");
// Copies of these live outside the app code: keep them in step.
const migration = await readFile(new URL("../supabase/migrations/20261001100000_member_cards.sql", import.meta.url), "utf8");
check("undo note matches the migration", migration.includes(`'${CARD_UNDO_NOTE}'`), CARD_UNDO_NOTE);
const backfill = await readFile(new URL("./card-points-backfill.mjs", import.meta.url), "utf8");
eq("the backfill dry run uses the same card limit", Number(/MAX_AUTO_LINKED_CARDS = (\d+)/.exec(backfill)?.[1]), MAX_AUTO_LINKED_CARDS);
eq("undo window is 2 minutes", CARD_UNDO_MS, 120000);

// ---------- 3. the matching rule ----------
const LIVE = { livemode: true };
const link = (memberId, extra = {}) => ({ memberId, livemode: true, removed: false, memberErased: false, memberLinksCards: true, linkedOrderId: null, ...extra });
const sale = (extra = {}) => ({ orderId: "o1", status: "completed", memberId: null, memberSource: null, ...extra });
const member = (extra = {}) => ({ erased: false, linksCards: true, activeCards: 0, isCashier: false, ...extra });

// Nobody on the sale.
eq("nobody on it, card unknown: nothing", decideCardOutcome(sale(), LIVE, [], null).kind, "skip");
eq("nobody on it, one member's card: theirs", decideCardOutcome(sale(), LIVE, [link("sarah")], null), { kind: "attach", memberId: "sarah" });
eq("nobody on it, a shared card: ask who", decideCardOutcome(sale(), LIVE, [link("sarah"), link("mike")], null), { kind: "choose", memberIds: ["sarah", "mike"] });
eq("a removed link doesn't find them", decideCardOutcome(sale(), LIVE, [link("sarah", { removed: true })], null).kind, "skip");
eq("a removed link leaves the other owner", decideCardOutcome(sale(), LIVE, [link("sarah", { removed: true }), link("mike")], null), { kind: "attach", memberId: "mike" });
eq("a removed member isn't found", decideCardOutcome(sale(), LIVE, [link("sarah", { memberErased: true })], null).kind, "skip");
eq("linking switched off: not found", decideCardOutcome(sale(), LIVE, [link("sarah", { memberLinksCards: false })], null).kind, "skip");
eq("a test card never matches a live sale", decideCardOutcome(sale(), LIVE, [link("sarah", { livemode: false })], null).kind, "skip");
eq("a live card never matches a test sale", decideCardOutcome(sale(), { livemode: false }, [link("sarah")], null).kind, "skip");
eq("test and live links don't make it shared", decideCardOutcome(sale(), LIVE, [link("sarah"), link("mike", { livemode: false })], null), { kind: "attach", memberId: "sarah" });
eq("a refunded sale: nothing", decideCardOutcome(sale({ status: "refunded" }), LIVE, [link("sarah")], null).kind, "skip");
eq("a voided sale: nothing", decideCardOutcome(sale({ status: "voided" }), LIVE, [link("sarah")], null).kind, "skip");
eq("owners are listed once each", cardOwners(LIVE, [link("sarah"), link("sarah")]), ["sarah"]);

// A member on the sale (attached by staff).
eq("a new card links to the member on the sale", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [], member()), { kind: "link", memberId: "mike" });
eq("their card already: just used", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("mike")], member({ activeCards: 1 })), { kind: "used", memberId: "mike" });
eq("linked by this very sale (a retried save): shown again", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("mike", { linkedOrderId: "o1" })], member({ activeCards: 1 })), { kind: "linked_here", memberId: "mike" });
eq("they removed it before: never linked again on its own", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("mike", { removed: true })], member()).kind, "skip");
eq("someone else's card: asked before sharing it, not linked", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah")], member()), { kind: "offer_shared", memberId: "mike", ownerIds: ["sarah"] });
eq("someone else's card on the cashier's own account: not even offered", decideCardOutcome(sale({ memberId: "sam" }), LIVE, [link("sarah")], member({ isCashier: true })).kind, "skip");
eq(`someone else's card, ${MAX_AUTO_LINKED_CARDS} cards already: not offered`, decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah")], member({ activeCards: MAX_AUTO_LINKED_CARDS })).kind, "skip");
eq("someone else's card, linking off: not offered", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah")], member({ linksCards: false })).kind, "skip");
eq("a removed member's card doesn't make it shared", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah", { memberErased: true })], member()), { kind: "link", memberId: "mike" });
eq("someone else removed it: links to this member", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah", { removed: true })], member()), { kind: "link", memberId: "mike" });
eq("someone else's test card doesn't block a live link", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah", { livemode: false })], member()), { kind: "link", memberId: "mike" });
eq("their test-mode link doesn't count as this live card", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("mike", { livemode: false, removed: true })], member()), { kind: "link", memberId: "mike" });
eq("the cashier's own account: asked, not linked", decideCardOutcome(sale({ memberId: "sam" }), LIVE, [], member({ isCashier: true })), { kind: "offer_self", memberId: "sam" });
eq(`${MAX_AUTO_LINKED_CARDS} cards already: no more on their own`, decideCardOutcome(sale({ memberId: "mike" }), LIVE, [], member({ activeCards: MAX_AUTO_LINKED_CARDS })).kind, "skip");
eq(`${MAX_AUTO_LINKED_CARDS - 1} cards: one more links`, decideCardOutcome(sale({ memberId: "mike" }), LIVE, [], member({ activeCards: MAX_AUTO_LINKED_CARDS - 1 })).kind, "link");
eq("linking switched off: not linked", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [], member({ linksCards: false })).kind, "skip");
eq("a removed member: nothing", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [], member({ erased: true })).kind, "skip");
eq("the member's row missing: nothing", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [], null).kind, "skip");
eq("found by the card already (a retried save): shown again", decideCardOutcome(sale({ memberId: "sarah", memberSource: "card" }), LIVE, [link("sarah")], member()), { kind: "already_matched", memberId: "sarah" });
eq("a member on a sale is never swapped for the card's owner", decideCardOutcome(sale({ memberId: "mike" }), LIVE, [link("sarah")], member()).kind !== "attach", true);
eq("names: one", nameList(["Sarah R."]), "Sarah R.");
eq("names: two", nameList(["Mike T.", "Sarah R."]), "Mike T. and Sarah R.");
eq("names: three", nameList(["Ana P.", "Mike T.", "Sarah R."]), "Ana P., Mike T. and Sarah R.");

// ---------- 4. the register's 2-minute buttons ----------
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "check-card-points-made-up-key";
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
const { noticeTiming, cardSaleScope } = await import("../src/lib/member-cards.ts");
const { openApproval } = await import("../src/lib/approval-token.ts");
const now = Date.parse("2026-10-01T20:00:00Z");
const justNow = new Date(now - 5_000).toISOString();
const t = noticeTiming("order-1", justNow, "login-1", now);
check("a sale 5 seconds ago gets a token", !!t.token);
eq("the buttons go 2 minutes after the sale", t.ttlMs, 115_000);
check("the token works for that sale and login", !!openApproval(t.token, cardSaleScope("order-1"), "login-1", now + 60_000));
check("not for another sale", !openApproval(t.token, cardSaleScope("order-2"), "login-1", now));
check("not from another register login", !openApproval(t.token, cardSaleScope("order-1"), "login-2", now));
check("not after the 2 minutes", !openApproval(t.token, cardSaleScope("order-1"), "login-1", Date.parse(justNow) + 120_001));
check("not as a manager's approval for something else", !openApproval(t.token, "item-settings", "login-1", now));
check("a tampered token fails", !openApproval(`${t.token}x`, cardSaleScope("order-1"), "login-1", now));
eq("a sale over 2 minutes old gets no buttons", noticeTiming("order-1", new Date(now - 121_000).toISOString(), "login-1", now), { token: null, ttlMs: null });
eq("a sale with no time gets no buttons", noticeTiming("order-1", null, "login-1", now), { token: null, ttlMs: null });
eq("a sale time in the future never gets more than 2 minutes", noticeTiming("order-1", new Date(now + 600_000).toISOString(), "login-1", now).ttlMs, 120_000);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll card-points checks passed.");
process.exit(failures ? 1 : 0);
