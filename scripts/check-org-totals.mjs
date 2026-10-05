// Organization accounts' register math (src/lib/orgs.ts and
// src/lib/register-totals.ts), no database needed:
//   - tax-included (even-dollar) totals for supported guests: every listed
//     price from $1 to $20, in cents steps of $0.25, and mixed carts, total
//     exactly the listed amount, with the tax inside it close to 8.725% of
//     what's left;
//   - comps: the day pass and one ticket per showing ring up at $0, a second
//     day pass or ticket is charged, and the books add up;
//   - the daily limit: blocked when used up, unless a manager overrides,
//     and someone already comped today never uses another.
//
// Usage: node scripts/check-org-totals.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`),
);
const { registerTotals, pointsEarned } = await import("../src/lib/register-totals.ts");
const { orgCompPlan, taxInside, compCountText } = await import("../src/lib/orgs.ts");
const { SALES_TAX_RATE } = await import("../src/lib/sales-tax.ts");

let failures = 0;
let passes = 0;
const check = (label, ok, detail = "") => {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
};
const cents = (n) => Math.round(n * 100);
const totalsFor = (lines, opts = {}) => registerTotals(lines, opts.member ?? null, false, !!opts.taxFree, false, false, { taxIncluded: opts.taxIncluded ?? false });

// 1. Even-dollar: each price alone, $1.00 to $20.00 in quarters.
for (let c = 100; c <= 2000; c += 25) {
  const price = c / 100;
  const t = totalsFor([{ unit: price, qty: 1 }], { taxIncluded: true });
  check(`$${price.toFixed(2)} totals to itself`, cents(t.total) === c, `total ${t.total}`);
  const before = t.total - t.tax;
  check(`$${price.toFixed(2)} tax inside is ~8.725% of the rest`, Math.abs(cents(t.tax) - cents(before * SALES_TAX_RATE)) <= 1, `tax ${t.tax} on ${before.toFixed(2)}`);
  check(`$${price.toFixed(2)} taxIncluded flag`, t.taxIncluded === true);
}
// The example: a $4 pizza is $3.68 + $0.32.
{
  const t = totalsFor([{ unit: 4, qty: 1 }], { taxIncluded: true });
  check("$4 pizza is $3.68 + $0.32", t.total === 4 && t.tax === 0.32 && cents(t.total - t.tax) === 368, JSON.stringify(t));
  const s = taxInside(4);
  check("taxInside(4)", s.beforeTax === 3.68 && s.tax === 0.32, JSON.stringify(s));
}
// Mixed carts: whole-dollar menus (and quarters) total exactly their sum.
let seed = 7;
const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
for (let i = 0; i < 500; i++) {
  const lines = Array.from({ length: 1 + rand(6) }, () => ({ unit: (100 + 25 * rand(77)) / 100, qty: 1 + rand(3) }));
  const listed = lines.reduce((s, l) => s + cents(l.unit) * l.qty, 0);
  const t = totalsFor(lines, { taxIncluded: true });
  check(`mixed cart ${i} totals to the listed sum`, cents(t.total) === listed, `${t.total} vs ${listed / 100}`);
  check(`mixed cart ${i} tax inside is sensible`, Math.abs(cents(t.tax) - cents((t.total - t.tax) * SALES_TAX_RATE)) <= 1);
}
// Normal (helpers, everyone else): tax on top, unchanged.
{
  const t = totalsFor([{ unit: 4, qty: 1 }]);
  check("$4 normal is $4.35", t.total === 4.35 && t.tax === 0.35 && !t.taxIncluded, JSON.stringify(t));
  const ex = totalsFor([{ unit: 4, qty: 1 }], { taxIncluded: true, taxFree: true });
  check("tax exempt wins over tax included", ex.total === 4 && ex.tax === 0 && !ex.taxIncluded);
}
// Insiders+ 10% with tax included: still the even total of what's left.
{
  const t = registerTotals([{ unit: 10, qty: 1 }], { tier: "Insiders+", points: 0 }, false, false, false, false, { taxIncluded: true });
  check("Insiders+ 10% then tax included: $9.00 total", t.total === 9 && t.tierDiscount === 1, JSON.stringify(t));
}

// 2. Comps.
const org = (over = {}) => ({ orgId: "o", orgName: "Easter Seals", role: "supported", active: true, limit: 20, used: 4, personCompedToday: false, dayPassToday: false, screeningsToday: [], ...over });
const DAY = { dayPass: true, screeningId: null };
const SHOW = (id) => ({ dayPass: false, screeningId: id });
const FOOD = { dayPass: false, screeningId: null };
{
  const lines = [
    { ...DAY, qty: 1, unit: 5 },
    { ...SHOW("a"), qty: 1, unit: 8 },
    { ...FOOD, qty: 1, unit: 4 },
  ];
  const plan = orgCompPlan(lines, org());
  check("day pass and ticket comped, food not", plan.comps.join() === "1,1,0" && plan.amount === 13 && plan.newComp && !plan.blocked, JSON.stringify(plan));
  const t = totalsFor(
    lines.map((l, i) => ({ unit: l.unit, qty: l.qty, comp: plan.comps[i] })),
    { taxIncluded: true },
  );
  check("comps ring at $0: a supported guest pays $4.00 even for the pizza", t.total === 4 && t.orgCompDiscount === 13 && t.subtotal === 17, JSON.stringify(t));
  const h = totalsFor(lines.map((l, i) => ({ unit: l.unit, qty: l.qty, comp: plan.comps[i] })));
  check("a helper pays the pizza plus tax", h.total === 4.35 && h.orgCompDiscount === 13, JSON.stringify(h));
  const pts = pointsEarned({ subtotal: t.subtotal, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, org_comp_discount: t.orgCompDiscount, tax_included: true, tax: t.tax });
  check("comps earn no points; tax-included earns on before-tax", Math.abs(pts - 3.68) < 0.001, String(pts));
}
{
  const plan = orgCompPlan([{ ...DAY, qty: 2, unit: 5 }, { ...SHOW("a"), qty: 2, unit: 8 }], org());
  const t = totalsFor([{ unit: 5, qty: 2, comp: plan.comps[0] }, { unit: 8, qty: 2, comp: plan.comps[1] }]);
  check("two day passes and two tickets: one of each comped", plan.comps.join() === "1,1" && t.orgCompDiscount === 13 && t.subtotal === 26, JSON.stringify(t));
}
{
  const plan = orgCompPlan([{ ...DAY, qty: 1, unit: 5 }, { ...DAY, qty: 1, unit: 5 }, { ...SHOW("a"), qty: 1, unit: 8 }, { ...SHOW("a"), qty: 1, unit: 8 }, { ...SHOW("b"), qty: 1, unit: 8 }], org());
  check("second day pass line and second ticket to the same show charged; another show comped", plan.comps.join() === "1,0,1,0,1", plan.comps.join());
}
{
  const plan = orgCompPlan([{ ...DAY, qty: 1, unit: 5 }, { ...SHOW("a"), qty: 1, unit: 8 }], org({ personCompedToday: true, dayPassToday: true, screeningsToday: ["a"] }));
  check("already had today's day pass and that show: nothing comped", plan.amount === 0 && !plan.blocked, JSON.stringify(plan));
  const later = orgCompPlan([{ ...SHOW("b"), qty: 1, unit: 8 }], org({ personCompedToday: true, dayPassToday: true, screeningsToday: ["a"], used: 20 }));
  check("a later movie the same day is covered, even at the limit", later.comps[0] === 1 && !later.newComp && !later.blocked, JSON.stringify(later));
}
{
  const none = orgCompPlan([{ ...DAY, qty: 1, unit: 5 }], null);
  check("no organization: nothing comped", none.amount === 0 && !none.blocked);
  const paused = orgCompPlan([{ ...DAY, qty: 1, unit: 5 }], org({ active: false }));
  check("paused organization: nothing comped", paused.amount === 0 && !paused.blocked);
  const food = orgCompPlan([{ ...FOOD, qty: 1, unit: 4 }], org({ used: 20 }));
  check("food only, at the limit: not blocked (nothing to comp)", !food.blocked && food.amount === 0);
}

// 3. The daily limit.
{
  const lines = [{ ...DAY, qty: 1, unit: 5 }];
  const at = orgCompPlan(lines, org({ used: 19 }));
  check("19 of 20 used: comped (the 20th)", at.amount === 5 && !at.blocked && !at.overLimit);
  const full = orgCompPlan(lines, org({ used: 20 }));
  check("20 of 20 used: blocked, charged", full.blocked && full.amount === 0 && full.comps[0] === 0, JSON.stringify(full));
  const t = totalsFor([{ unit: 5, qty: 1, comp: full.comps[0] }]);
  check("blocked day pass is charged with tax", t.total === 5.44, String(t.total));
  const over = orgCompPlan(lines, org({ used: 20 }), true);
  check("manager override: comped, marked over the limit", over.amount === 5 && over.overLimit && !over.blocked, JSON.stringify(over));
  const zero = orgCompPlan(lines, org({ used: 0, limit: 0 }));
  check("a limit of 0 blocks every comp", zero.blocked);
}
check("count text", compCountText(6, 20) === "6/20 · 3 pairs" && compCountText(3, 20) === "3/20 · 1 pair", compCountText(6, 20));

// Nothing else changed: no comps, no tax-included is the old math.
{
  const t = registerTotals([{ unit: 3.5, qty: 2 }, { unit: 7.25, qty: 1 }], { tier: "Insiders+", points: 0 }, false, false, false, false);
  check("plain order unchanged", t.orgCompDiscount === 0 && !t.taxIncluded && t.total === Math.round((14.25 - 1.43 + Math.round((14.25 - 1.43) * SALES_TAX_RATE * 100) / 100) * 100) / 100, JSON.stringify(t));
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
