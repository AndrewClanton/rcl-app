// Checks sales tax without a database (nothing is read from or written to
// the live one):
//  1. One rate, 8.725%, kept in src/lib/sales-tax.ts and nowhere else.
//  2. Rounding: to the nearest cent, half a cent up, figured once on the
//     whole order (not line by line), with no floating-point cent lost.
//  3. Discounts come off before tax (Insiders+ 10%, monthly 10%, a points
//     reward, the daily coffee); a tip is never taxed.
//  4. Exempt: nothing on the menu is; only a whole order ticked "Tax
//     exempt" goes untaxed, and the register asks a manager PIN for it.
//  5. Memberships with no tax on top, counted as tax-included in Reports:
//     $15.00 is $13.80 + $1.20.
//  6. Booth bookings carry tax at checkout, like online tickets.
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
const { registerTotals } = await import("../src/lib/register-totals.ts");
const { REWARD_VALUE, POINTS_PER_REWARD } = await import("../src/lib/loyalty.ts");

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
const elsewhere = files(srcDir).filter((p) => !p.replace(/\\/g, "/").endsWith("lib/sales-tax.ts") && /\b(8\.725|0\.08725|1\.08725)\b|TAX_RATE\s*=\s*0\.\d/.test(readFileSync(p, "utf8")));
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
check("ticking Tax exempt asks for a manager PIN first", /checked \? setAskTaxExempt\(true\) : setTaxFree\(false\)/.test(pos) && /approveTaxExempt\(pin/.test(pos));
check("the PIN is checked and logged on the server", /checkManagerPin\(pin, "tax-exempt"/.test(read("src/app/pos/actions.ts")));

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

console.log(failures ? `\n${failures} failed` : "\nAll good.");
process.exit(failures ? 1 : 0);
