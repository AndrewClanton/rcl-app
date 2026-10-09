// Checks the Insiders+ daily coffee without a database (nothing is read
// from or written to the live one):
//  1. The math in src/lib/register-totals.ts, which the register and the
//     server's sale check both use: one daily coffee item comes off at its
//     menu price (add-ons still charged), only for an Insiders+ member and
//     only when it's on; it comes off before the percentage discounts; it
//     earns no points; and an order without one adds up exactly as before.
//  2. The receipt prints its line in plain ASCII, within the paper.
//  3. Migration 20261001220000: one completed order per member and day, so
//     a refund or void frees the day; merges can't trip over it; the seed
//     ticks only Drip coffee and Batch brew, once.
//
// Usage: node scripts/check-daily-coffee.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { readFileSync } from "node:fs";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { registerTotals, pointsEarned, dailyPerkPick, cents } = await import("../src/lib/register-totals.ts");
const { SALES_TAX_RATE } = await import("../src/lib/sales-tax.ts");
const { POINTS_PER_REWARD, REWARD_VALUE, rewardPointsFor } = await import("../src/lib/loyalty.ts");
const { DAILY_COFFEE_LINE, DAILY_COFFEE_PERK } = await import("../src/lib/daily-perk.ts");
const { receiptXml } = await import("../src/lib/print/receipt.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const plus = { tier: "Insiders+", points: 40 };
const insider = { tier: "Insiders", points: 40 };
const coffee = (extra = 0, qty = 1) => ({ unit: 3 + extra, qty, perkBase: 3 });
const latte = { unit: 5.5, qty: 1, perkBase: null };
const payload = (t) => ({ subtotal: t.subtotal, daily_perk_discount: t.dailyPerkDiscount, tier_discount: t.tierDiscount, monthly_discount: t.monthlyDiscount, redemption_discount: t.redemptionDiscount });

// 1. The math.
{
  const t = registerTotals([coffee()], plus, false, false, false, true);
  check("a plain coffee for Insiders+ is free", t.dailyPerkDiscount === 3 && t.tierDiscount === 0 && t.tax === 0 && t.total === 0, JSON.stringify(t));
  check("and earns no points", pointsEarned(payload(t)) === 0);
  check("and says which line it's on", t.dailyPerkLine === 0);
}
{
  const t = registerTotals([coffee(0.75)], plus, false, false, false, true);
  check("an add-on on it is still charged (less 10%, plus tax)", t.dailyPerkDiscount === 3 && t.tierDiscount === 0.08 && t.total === cents(0.67 + cents(0.67 * SALES_TAX_RATE)), JSON.stringify(t));
}
{
  const t = registerTotals([coffee(), latte], plus, false, false, false, true);
  check("10% comes off what's left after the coffee", t.dailyPerkDiscount === 3 && t.tierDiscount === 0.55, JSON.stringify(t));
  check("points are 1 per $1 after every discount", pointsEarned(payload(t)) === cents(8.5 - 3 - 0.55));
}
{
  const t = registerTotals([coffee(0, 2)], plus, false, false, false, true);
  check("two coffees on one line: one is free", t.dailyPerkDiscount === 3 && t.subtotal === 6, JSON.stringify(t));
}
{
  const t = registerTotals([latte, { unit: 3, qty: 1, perkBase: 3 }, { unit: 3.5, qty: 1, perkBase: 3.5 }], plus, false, false, false, true);
  check("with two eligible lines it goes on the one worth more", t.dailyPerkLine === 2 && t.dailyPerkDiscount === 3.5, JSON.stringify(t));
}
check("an option that lowers the price can't push it below nothing", dailyPerkPick([{ unit: 2.5, qty: 1, perkBase: 3 }])?.amount === 2.5);
check("an item that isn't a daily coffee is never picked", dailyPerkPick([latte, { unit: 0, qty: 1, perkBase: null }]) === null);
check("not for an Insiders member", registerTotals([coffee()], insider, false, false, false, true).dailyPerkDiscount === 0);
check("not with no member", registerTotals([coffee()], null, false, false, false, true).dailyPerkDiscount === 0);
check("not when it's off (used, unknown, or removed)", registerTotals([coffee()], plus, false, false, false, false).dailyPerkDiscount === 0);
{
  const t = registerTotals([coffee(), latte], { tier: "Insiders+", points: POINTS_PER_REWARD }, true, false, true, true);
  const rest = 5.5;
  check("monthly 10% and a reward are figured after the coffee", t.monthlyDiscount === 0.55 && t.redemptionDiscount === cents(Math.min(REWARD_VALUE, rest - 0.55 - 0.55)), JSON.stringify(t));
  check("never a negative total", t.total >= 0 && t.tax >= 0);
}
{
  const t = registerTotals([coffee()], plus, false, true, false, true);
  check("tax exempt still works", t.tax === 0 && t.total === 0);
}

// Without a daily coffee, every order adds up exactly as it did before it
// existed (the old formula, copied here).
function before(lines, member, monthly, taxFree, redeemed) {
  const subtotal = cents(lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const rate = !member ? 0 : member.tier === "Insiders+" ? 0.1 : 0;
  const tierDiscount = cents(subtotal * rate);
  const monthlyDiscount = monthly ? cents(subtotal * 0.1) : 0;
  // Since Oct 9 the reward only needs the points for what it takes off
  // (lib/loyalty.ts rewardPointsFor; scripts/check-prorate-points.mjs).
  const could = cents(Math.min(REWARD_VALUE, Math.max(0, subtotal - tierDiscount - monthlyDiscount)));
  const canRedeem = !!member && member.points >= (could > 0 ? rewardPointsFor(could) : POINTS_PER_REWARD);
  const redemptionDiscount = canRedeem && redeemed ? could : 0;
  const discount = tierDiscount + monthlyDiscount + redemptionDiscount;
  const taxable = subtotal - discount;
  const tax = taxFree ? 0 : cents(Math.max(0, taxable) * SALES_TAX_RATE);
  return { subtotal, tierDiscount, monthlyDiscount, redemptionDiscount, discount, tax, total: cents(Math.max(0, taxable) + tax) };
}
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let same = 0;
const runs = 5000;
for (let i = 0; i < runs; i++) {
  const lines = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => ({ unit: cents(rand() * 14), qty: 1 + Math.floor(rand() * 3), perkBase: rand() < 0.3 ? 3 : null }));
  const member = [null, insider, plus, { tier: "Insiders+", points: 250 }][Math.floor(rand() * 4)];
  const args = [lines, member, rand() < 0.3, rand() < 0.2, rand() < 0.5];
  const a = registerTotals(...args, false);
  const b = before(...args);
  if (Object.keys(b).every((k) => a[k] === b[k]) && a.dailyPerkDiscount === 0) same++;
}
check(`orders without a daily coffee add up exactly as before (${runs} random orders)`, same === runs, `${runs - same} differ`);
check("points for an order rung before the coffee existed", pointsEarned({ subtotal: 10, tier_discount: 1, monthly_discount: 0, redemption_discount: 0 }) === 9);

// 2. The receipt.
{
  const xml = receiptXml({
    orderNumber: 1201,
    at: "2026-10-01T14:14:00Z",
    cashier: "Sam",
    member: "Test Member",
    orderName: null,
    lines: [{ name: "Drip coffee", qty: 1, unit: 3.75, mods: ["Oat milk"] }],
    subtotal: 3.75,
    discounts: [{ label: DAILY_COFFEE_LINE, amount: 3 }, { label: "Member discount", amount: 0.08 }],
    tax: 0.06,
    tip: 0,
    total: 0.73,
    payments: [{ label: "Cash", amount: 0.73 }],
  });
  check("the receipt prints the daily coffee line", /Insiders\+ daily coffee\s+-\$3\.00/.test(xml));
  check("its label is plain ASCII", !/[^\x20-\x7E]/.test(DAILY_COFFEE_LINE));
}
check("customer copy uses the agreed wording", DAILY_COFFEE_PERK === "A free black coffee or hot tea, every day");

// 3. The migration.
{
  const sql = readFileSync(new URL("../supabase/migrations/20261001230000_plus_daily_coffee.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  check("menu_items.daily_perk, off by default", /alter table menu_items add column if not exists daily_perk boolean not null default false/.test(sql));
  check("orders.daily_perk_discount like the other discounts", /add column if not exists daily_perk_discount numeric\(10,2\) not null default 0/.test(sql));
  check("one completed order per member and day", /create unique index if not exists orders_daily_perk_once\s+on orders \(member_id, daily_perk_date\)\s+where daily_perk_date is not null and status = 'completed'/.test(sql));
  check("the register knows the index by name", readFileSync(new URL("../src/app/pos/actions.ts", import.meta.url), "utf8").includes('"orders_daily_perk_once"'));
  check("a merge moving a same-day coffee clears its date instead of failing", /before update of member_id on orders/.test(sql) && /new\.daily_perk_date := null/.test(sql));
  check("the seed ticks Drip coffee and Batch brew in Caffe, only if nothing is ticked yet", /lower\(name\) in \('drip coffee', 'batch brew'\)/.test(sql) && /key = 'caffe'/.test(sql) && /if exists \(select 1 from menu_items where daily_perk\)/.test(sql));
  check("nothing creates a hot tea item or sets a price", !/insert into menu_items/i.test(sql) && !/set price/i.test(sql));
}

console.log(failures ? `\n${failures} failed` : "\nAll good.");
process.exit(failures ? 1 : 0);
