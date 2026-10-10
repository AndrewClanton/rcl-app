// Checks sales tax without a database (nothing is read from or written to
// the live one):
//  1. One rate, 8.725%, kept in src/lib/sales-tax.ts and nowhere else.
//  2. Rounding: to the nearest cent, half a cent up, figured once on the
//     whole order (not line by line), with no floating-point cent lost.
//  3. Discounts come off before tax (Insiders+ 10%, monthly 10%, a points
//     reward, the daily coffee); a tip is never taxed.
//  4. Exempt: nothing on the menu is; only a whole order ticked "Tax
//     exempt" goes untaxed, and the register asks a reason and a manager
//     PIN for it, saved on the order. Reports and the nightly email list
//     each one with who and why (older ones: who rang it, no reason).
//  5. Memberships with no tax on top, counted as tax-included in Reports:
//     $15.00 is $13.80 + $1.20.
//  6. Booth bookings carry tax at checkout, like online tickets.
//  7. Gift cards: untaxed when sold (no manager PIN), no discount or
//     points on them; taxed when spent, since a gift card pays like cash.
//
// Usage: node scripts/check-sales-tax.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { SALES_TAX_PERCENT, SALES_TAX_RATE, salesTaxOn, taxInsideCents, UNTAXED_MEMBERSHIPS } = await import("../src/lib/sales-tax.ts");
const { registerTotals, isGiftCardLine, pointsEarned } = await import("../src/lib/register-totals.ts");
const { REWARD_VALUE, POINTS_PER_REWARD } = await import("../src/lib/loyalty.ts");
const { TAX_EXEMPT_REASONS, taxFreeOrders, taxFreeLine, taxFreeCallout, taxFreeStaffIds } = await import("../src/lib/tax-exempt.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

// 1. The rate.
check("the rate is 8.725%", SALES_TAX_PERCENT === 8.725 && Math.abs(SALES_TAX_RATE - 0.08725) < 1e-12);
const srcDir = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const elsewhere = files(srcDir).filter((p) => !p.replace(/\\/g, "/").endsWith("lib/sales-tax.ts") && /\b(8\.725|0\.08725|1\.08725)\b|TAX_RATE\s*=\s*0\.\d/.test(readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "")));
check("no other file has its own copy of the rate", elsewhere.length === 0, elsewhere.join(", "));
check("Stripe's tax rate is made from the same number", /percentage:\s*SALES_TAX_PERCENT/.test(read("src/lib/stripe-tax.ts")) && /inclusive:\s*false/.test(read("src/lib/stripe-tax.ts")));

// 2. Rounding.
check("$5.00 -> $0.44", salesTaxOn(5) === 0.44);
check("$10.00 -> $0.87", salesTaxOn(10) === 0.87);
check("$15.00 -> $1.31 (Insiders+ monthly, tax on top: $16.31)", salesTaxOn(15) === 1.31 && Math.round((15 + salesTaxOn(15)) * 100) === 1631);
check("$20.00 -> $1.75 (a half cent rounds up)", salesTaxOn(20) === 1.75);
check("$180.00 -> $15.71 (plain floating point said $15.70)", salesTaxOn(180) === 15.71);
let off = 0;
for (let c = 0; c <= 500_000; c++) if (salesTaxOn(c / 100) !== Math.floor((c * 8725 + 50_000) / 100_000) / 100) off++;
check("every amount $0.00-$5,000.00 matches whole-cent rounding", off === 0, off ? `${off} off` : "");
check("never negative", salesTaxOn(-3) === 0);
{
  // Two $5 nachos and a $1 soda: tax on the $11 order, not 44c + 44c + 9c.
  const t = registerTotals([{ unit: 5, qty: 2 }, { unit: 1, qty: 1 }], null, false, false, false);
  check("tax is figured on the whole order", t.tax === 0.96 && t.total === 11.96, `tax ${t.tax}`);
}

// 3. Discounts before tax; tips untaxed.
const plus = { tier: "Insiders+", points: 0 };
const rich = { tier: "Insiders", points: POINTS_PER_REWARD };
{
  const t = registerTotals([{ unit: 10, qty: 2 }], plus, false, false, false);
  check("Insiders+ 10% comes off first: $20 -> $18 taxed -> $1.57", t.tierDiscount === 2 && t.tax === 1.57 && t.total === 19.57);
}
{
  const t = registerTotals([{ unit: 10, qty: 2 }], { tier: "Insiders", points: 0 }, false, false, false);
  check("plain Insiders: no discount, full $20 taxed -> $1.75", t.discount === 0 && t.tax === 1.75);
}
{
  const t = registerTotals([{ unit: 10, qty: 2 }], null, true, false, false);
  check("monthly member 10% comes off first -> $1.57", t.monthlyDiscount === 2 && t.tax === 1.57);
}
{
  const t = registerTotals([{ unit: 10, qty: 2 }], rich, false, false, true);
  check(`a ${"$" + REWARD_VALUE} points reward comes off first`, t.redemptionDiscount === REWARD_VALUE && t.tax === salesTaxOn(20 - REWARD_VALUE));
  const small = registerTotals([{ unit: 4, qty: 1 }], rich, false, false, true);
  check("a reward bigger than the order: no tax, never a refund", small.tax === 0 && small.total === 0);
}
{
  // Daily coffee ($3 drip, free) plus $10 nachos for an Insiders+ member:
  // $13 - $3 = $10, 10% off = $9, tax $0.79.
  const t = registerTotals([{ unit: 3, qty: 1, perkBase: 3 }, { unit: 10, qty: 1, perkBase: null }], plus, false, false, false, true);
  check("daily coffee and 10% come off before tax -> $0.79", t.dailyPerkDiscount === 3 && t.tierDiscount === 1 && t.tax === 0.79, `tax ${t.tax}`);
}
{
  const t = registerTotals([{ unit: 10, qty: 2 }], null, false, false, false);
  check("the order total is goods + tax; a tip is added on top, untaxed", t.total === 21.75 && !Object.keys(t).some((k) => /tip/i.test(k)));
}

// 4. Exempt.
{
  const t = registerTotals([{ unit: 5, qty: 1 }], null, false, true, false);
  check("an order ticked Tax exempt: no tax", t.tax === 0 && t.total === 5);
}
const schema = readdirSync(new URL("../supabase/migrations/", import.meta.url)).map((f) => read(`supabase/migrations/${f}`)).join("\n");
check("no menu item or category can be tax-free (no such column)", !/menu_(items|categories)[^;]*\b(tax_exempt|taxable|tax_free|no_tax)\b/i.test(schema));
const pos = read("src/app/pos/PosApp.tsx");
check("ticking Tax exempt asks for a manager PIN first", /checked \? setAskTaxExempt\(true\) : setTaxFree\(false\)/.test(pos));
check("the PIN is checked and logged on the server", /checkManagerPin\(input\.pin, "tax-exempt"/.test(read("src/app/pos/actions.ts")));

check("the three reasons", JSON.stringify(Object.keys(TAX_EXEMPT_REASONS)) === JSON.stringify(["certificate", "courtesy", "other"]));
check("the register asks a reason too", /approveTaxExempt\(\{ pin, tabId: activeTabId, cashierId/.test(pos) && /<TaxExemptModal/.test(pos));
{
  const actions = read("src/app/pos/actions.ts");
  check('"other" needs a note', /input\.reason === "other" && !note/.test(actions));
  check("the reason goes on the order only when it's tax-free", /if \(!taxFree \|\| !mark/.test(actions) && (actions.match(/\.\.\.taxExemptColumns\(/g) ?? []).length === 3);
  const mig = read("supabase/migrations/20261009110000_tax_exempt_reason.sql");
  check("the migration only adds columns (no old order is changed)", /add column if not exists tax_exempt_reason/.test(mig) && !/\bupdate\s+orders\b|\bdelete\s+from\b/i.test(mig.replace(/^--.*$/gm, "")));
}
{
  const at = "2026-10-03T01:41:00Z"; // Oct 2, 8:41 PM in Joplin
  const base = { id: "a", order_number: 1001, completed_at: at, status: "completed", tax_free: true, tip: 0, total: 5, employee: { name: "Gage Smith" } };
  const now = taxFreeOrders([{ ...base, tax_exempt_reason: "courtesy", tax_exempt_marker: { name: "Andrew Clanton" }, tax_exempt_approver: { name: "Andrew Clanton" } }]);
  check("the report line", taxFreeLine(now[0]) === "Oct 2, 8:41 PM · $5.00 · $0.44 not charged · marked by Andrew · Courtesy", taxFreeLine(now[0]));
  const cert = taxFreeOrders([{ ...base, tip: 2, total: 22, tax_exempt_reason: "certificate", tax_exempt_note: "12345", tax_exempt_marker: { name: "Gage" }, tax_exempt_approver: { name: "Mary" } }]);
  check("a certificate approved by someone else; the tip isn't in it", taxFreeLine(cert[0]) === "Oct 2, 8:41 PM · $20.00 · $1.75 not charged · marked by Gage, approved by Mary · Tax-exempt certificate #12345", taxFreeLine(cert[0]));
  const other = taxFreeOrders([{ ...base, tax_exempt_reason: "other", tax_exempt_note: "church group" }]);
  check("other, with its note (no cashier picked: who rang it)", taxFreeLine(other[0]).endsWith("marked by Gage · Other: church group"), taxFreeLine(other[0]));
  const old = taxFreeOrders([base]);
  check("an older order: who rang it, no reason recorded", taxFreeLine(old[0]) === "Oct 2, 8:41 PM · $5.00 · $0.44 not charged · rung by Gage · no reason recorded", taxFreeLine(old[0]));
  check("only finished tax-free orders are listed", taxFreeOrders([{ ...base, tax_free: false }, { ...base, status: "voided" }]).length === 0);
  check("the callout", taxFreeCallout(now) === "1 tax-free order today: $0.44 of tax not charged." && taxFreeCallout([]) === null);
  check("names are looked up only for tax-free orders", JSON.stringify(taxFreeStaffIds([{ ...base, tax_exempt_marked_by: "e1", tax_exempt_approved_by: "e2" }, { ...base, tax_free: false, tax_exempt_marked_by: "e3" }])) === JSON.stringify(["e1", "e2"]));
}
{
  const screens = ["src/app/admin/reports/DayScreen.tsx", "src/app/admin/reports/PeriodView.tsx", "src/app/admin/reports/tax/TaxScreen.tsx"];
  const missing = screens.filter((p) => !/<TaxFreeOrdersCard/.test(read(p)));
  check("Day, Week/Month and Sales tax list tax-free orders", missing.length === 0, missing.join(", "));
  check("the Day report has the callout at the top", /<TaxFreeCallout/.test(read("src/app/admin/reports/DayScreen.tsx")));
  const email = read("src/lib/email/daily-digest-email.ts");
  check("the nightly email has the callout and the list", /taxFreeCallout\(r\.taxFreeOrders\)/.test(email) && /map\(taxFreeLine\)/.test(email));
}

// 5. Memberships with no tax on top.
check("the membership setting is included or none", UNTAXED_MEMBERSHIPS === "included" || UNTAXED_MEMBERSHIPS === "none", UNTAXED_MEMBERSHIPS);
check("$15.00 tax-included is $13.80 + $1.20", taxInsideCents(1500) === 120);
check("$153.00 yearly tax-included is $140.72 + $12.28", taxInsideCents(15300) === 1228);
check("a refund of one splits the same way", taxInsideCents(-1500) === -120);
check("Reports read memberships through the setting", /rows: rows\.map\(withTaxInside\)/.test(read("src/lib/membership-payments/read.ts")));

// 6. Booths.
const booths = read("src/app/(site)/booths/actions.ts");
check("booth checkout adds the sales tax rate", /tax_rates:\s*\[taxRate\]/.test(booths) && /salesTaxRateId\(\)/.test(booths));
check("online tickets still add it", /tax_rates:\s*\[taxRate\]/.test(read("src/app/(site)/showtimes/[id]/actions.ts")));

// 7. Gift cards.
check(
  "a gift card line: the button's and the old custom item's names",
  isGiftCardLine({ menu_item_id: null, name: "Gift card" }) && isGiftCardLine({ menu_item_id: null, name: "$50 Gift Card" }) && isGiftCardLine({ menuItemId: null, name: "giftcard" }),
);
check(
  "not a gift card: a menu item, or anything else",
  !isGiftCardLine({ menu_item_id: "x", name: "Gift card" }) && !isGiftCardLine({ menu_item_id: null, name: "Gift card refund" }) && !isGiftCardLine({ menu_item_id: null, name: "Nachos" }),
);
{
  // A $50 gift card and $10 nachos: tax on the $10 only.
  const t = registerTotals([{ unit: 50, qty: 1, giftCard: true }, { unit: 10, qty: 1 }], null, false, false, false);
  check("a gift card sold isn't taxed: $50 card + $10 nachos -> $0.87 tax, $60.87", t.tax === 0.87 && t.total === 60.87 && t.subtotal === 60 && t.giftCardSales === 50, `tax ${t.tax} total ${t.total}`);
  const alone = registerTotals([{ unit: 25, qty: 2, giftCard: true }], null, false, false, false);
  check("two $25 cards alone: $50.00, no tax", alone.tax === 0 && alone.total === 50);
  const p = registerTotals([{ unit: 50, qty: 1, giftCard: true }, { unit: 10, qty: 1 }], plus, true, false, false);
  check("no member or monthly 10% off a gift card", p.tierDiscount === 1 && p.monthlyDiscount === 1 && p.total === Math.round((50 + 8 + salesTaxOn(8)) * 100) / 100, `total ${p.total}`);
  check("no points for the gift card, points for the nachos", pointsEarned({ subtotal: 60, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, gift_card_sales: 50 }) === 10);
  check("the register marks gift card lines itself (no Tax exempt, no PIN)", /giftCard: isGiftCardLine\(l\)/.test(read("src/app/pos/PosApp.tsx")));
  check("the server pays no points on gift cards sold", /gift_card_sales: giftCards/.test(read("src/app/pos/actions.ts")));
  check("the totals check knows gift card lines", /giftCard: isGiftCardLine\(sale\.lines\[i\]\)/.test(read("src/lib/register-sale-checks.ts")));
}

console.log(failures ? `\n${failures} failed` : "\nAll good.");
process.exit(failures ? 1 : 0);
