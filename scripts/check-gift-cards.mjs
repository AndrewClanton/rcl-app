// Checks gift cards without a database (nothing is read from or written to
// the live one). How they work: src/lib/gift-cards.ts.
//  1. Codes: RCL-XXXX-XXXX, crypto random, no 0/O or 1/I/L; typed or
//     scanned codes are read in any case, with or without dashes.
//  2. Selling: untaxed, no discounts, no points, no manager PIN.
//  3. Spending: a way to pay, so the order is taxed as usual; the balance
//     comes off in one locked step and never below zero.
//  4. Refunds put the money back; Back office changes need a reason.
//  5. The migration grants what the app uses.
//
// Usage: node scripts/check-gift-cards.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { GIFT_CODE_ALPHABET, giftCodeFrom, normalizeGiftCode, isGiftCode, giftAmountProblem, GIFT_CARD_LINE_NAME } = await import("../src/lib/gift-cards.ts");
const { registerTotals, isGiftCardLine, pointsEarned } = await import("../src/lib/register-totals.ts");
const { salesTaxOn } = await import("../src/lib/sales-tax.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// 1. Codes.
check("no look-alike characters in codes", !/[01OIL]/.test(GIFT_CODE_ALPHABET) && GIFT_CODE_ALPHABET.length === 31);
{
  const seen = new Set();
  let bad = 0;
  const counts = new Map();
  for (let i = 0; i < 20000; i++) {
    const c = giftCodeFrom(randomBytes(24));
    if (!isGiftCode(c)) bad++;
    seen.add(c);
    for (const ch of c.slice(4).replace("-", "")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  check("20,000 new codes are all well-formed and different", bad === 0 && seen.size === 20000, `${bad} bad, ${seen.size} unique`);
  const vals = [...counts.values()];
  check("every letter shows up about equally (no bias)", counts.size === 31 && Math.max(...vals) / Math.min(...vals) < 1.15);
}
check("a typed code: any case, spaces, no dashes", normalizeGiftCode(" rcl abcd 2345 ") === "RCL-ABCD-2345" && normalizeGiftCode("abcd2345") === "RCL-ABCD-2345");
check("not a code: wrong length, or a 0/O/1/I/L", normalizeGiftCode("RCL-ABCD-234") === null && normalizeGiftCode("RCL-ABCD-2340") === null && normalizeGiftCode("RCL-OBCD-2345") === null && normalizeGiftCode("RCL-ABCL-2345") === null);
check("amounts: $1 to $1,000, whole cents", giftAmountProblem(50) === null && giftAmountProblem(12.5) === null && !!giftAmountProblem(0) && !!giftAmountProblem(1001) && !!giftAmountProblem(10.005));

// 2. Selling.
check("the button's line is a gift card line", isGiftCardLine({ menu_item_id: null, name: GIFT_CARD_LINE_NAME }));
{
  const plus = { tier: "Insiders+", points: 0 };
  const t = registerTotals([{ unit: 50, qty: 1, giftCard: true }, { unit: 10, qty: 1 }], plus, false, false, false);
  check("a $50 card + $10 nachos (Insiders+): 10% and tax on the nachos only", t.tierDiscount === 1 && t.tax === salesTaxOn(9) && t.total === Math.round((50 + 9 + salesTaxOn(9)) * 100) / 100, `total ${t.total}`);
  check("no points for the card", pointsEarned({ subtotal: 60, tier_discount: 1, monthly_discount: 0, redemption_discount: 0, gift_card_sales: 50 }) === 9);
}
const pos = read("src/app/pos/PosApp.tsx");
const actions = read("src/app/pos/actions.ts");
check("the register has a Gift card button by + Custom item", (pos.match(/onClick=\{\(\) => setGiftSellOpen\(true\)\}/g) ?? []).length === 2);
check("selling one asks no PIN (no Tax exempt involved)", !/GiftCardSellModal[\s\S]{0,400}setAskTaxExempt/.test(pos));
check("the card is made after the sale saves, once per line and copy", /issueOrderGiftCards\(\{ orderId/.test(actions) && /issue:\$\{sale\.orderId\}:\$\{i\}:\$\{n\}/.test(read("src/lib/gift-cards-server.ts")));
check("the code prints on the receipt and a slip", /Code: \$\{c\}/.test(pos) && /printGiftSlips\(soldCards/.test(pos) && /GIFT CARD/.test(read("src/lib/print/receipt.ts")));
check("no staff name on the slip", !/cashier|employee/i.test(read("src/lib/print/receipt.ts").split("// ---------- gift card slip ----------")[1].split("export function drawerXml")[0]));
check("the kitchen doesn't get a ticket for a gift card", /!isGiftCardLine\(l\)/.test(read("src/lib/print/kitchen.ts")));

// 3. Spending.
const pay = read("src/app/pos/PaymentModal.tsx");
check("paying with a gift card rides along with cash and card (a way to pay, not a discount)", /\.\.\.\(gift \? \{ giftCard: gift \} : \{\}\)/.test(pay) && /method: "gift_card"/.test(pay));
check("a gift card can't pay for a gift card", /giftCardOk=\{!cart\.some\(\(l\) => isGiftCardLine\(l\)\)\}/.test(pos) && /can't pay for another gift card/.test(actions));
const mig = read("supabase/migrations/20261009120000_gift_cards.sql");
const redeem = mig.split("function public.redeem_gift_card")[1].split("$$;")[0];
check("redeeming locks the card's row", /for update/.test(redeem));
check("redeeming refuses more than the balance", /v_card\.balance < v_amount/.test(redeem));
check("a balance can never go below zero (constraint)", /balance numeric\(10, 2\) not null check \(balance >= 0\)/.test(mig));
check("a retried sale takes the money once (idempotency key)", /idempotency_key text unique/.test(mig) && /'repeat', true/.test(redeem));
check("a sale that didn't save puts the money back", /undoGiftCardRedemption\(key/.test(actions));
check("split with card or cash: the gift card covers part, the rest is due", /const due = Math\.round\(\(total - voucher - \(gift\?\.amount \?\? 0\)\) \* 100\) \/ 100;/.test(pay));

// 4. Refunds and Back office.
check("a full refund puts gift card money back and voids cards it sold", /refundOrderGiftCards\(orderId/.test(read("src/app/admin/reports/actions.ts")) && /'void'/.test(mig.split("refund_order_gift_cards")[1]));
check("a manager's change needs a reason, and is in the history", /length\(trim\(p_reason\)\) < 3/.test(mig) && /assertManager\(\)/.test(read("src/app/admin/gift-cards/actions.ts")));
check("Back office -> Gift cards is for managers", /requireManager\(\)/.test(read("src/app/admin/gift-cards/page.tsx")) && /href: "\/admin\/gift-cards"[\s\S]{0,300}min: "manager"/.test(read("src/app/admin/_nav/map.ts")));
check("My Account shows the member's cards", /memberGiftCards\(member\.id\)/.test(read("src/app/(site)/account/(member)/page.tsx")));

// 5. Grants and RLS.
check("both tables: RLS on, service role only", /alter table gift_cards enable row level security/.test(mig) && /alter table gift_card_transactions enable row level security/.test(mig) && !/to anon|to authenticated/.test(mig.replace(/from public, anon, authenticated/g, "")));
check("Indy's gift cards aren't touched", !/indy/i.test(mig.replace(/^--.*$/gm, "")));

console.log(failures ? `\n${failures} failed` : "\nAll good.");
process.exit(failures ? 1 : 0);
