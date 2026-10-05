// Checks the owner rate and the owner tab without a database:
//  1. The math (lib/register-totals.ts): a recipe's cost, the half-price
//     fallback, options at half, tickets and custom items at their normal
//     price, never more than the menu, the order taxed with nothing else
//     off (no member discount, monthly 10%, reward or daily coffee), and a
//     register price that doesn't match the server's being caught. Normal
//     sales' math pinned to known figures, so it can't drift.
//  2. The owner's PIN approval (lib/approval-token.ts): for that owner and
//     that one order only, from that login, and only for 10 minutes.
//  3. The register's server side against in-memory stand-ins
//     (scripts/check-owner-tab-fakes.mjs): approveOwnerRate (only a ticked
//     owner, only their own PIN, never 9999), priceOwnerSale and
//     completeOwnerTabOrder (the order saved at the server's prices with no
//     money taken, no member and no points; a repeat finds the same order; a
//     register price that doesn't match, a run-out or borrowed approval and
//     a card payment are all refused), and completeOrder refusing 'owner_tab'.
//
// Usage: node scripts/check-owner-tab.mjs   (Node 22.18+ runs the .ts directly)
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = path.join(root, "src");
const fakesUrl = new URL("./check-owner-tab-fakes.mjs", import.meta.url).href;
const STUBBED = {
  "server-only": fakesUrl,
  "next/server": fakesUrl,
  "next/cache": fakesUrl,
  "@/lib/supabase/admin": fakesUrl,
  "@/lib/auth": fakesUrl,
};
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = withExt(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(src)) {
        const file = withExt(path.resolve(path.dirname(parent), specifier));
        if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

// A made-up signing key, in this process only: nothing real is signed.
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-real-key";
// Anything that tries the network fails loudly.
globalThis.fetch = async (url) => {
  throw new Error(`no network in this check (${url})`);
};

const fakes = await import(fakesUrl);
const { db, staff, flushAfter } = fakes;
const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const T = await load("lib/register-totals.ts");
const PRICING = await load("lib/bar/pricing.ts");
const tokens = await load("lib/approval-token.ts");
const { hashPin, DEFAULT_PIN_HASH } = await load("lib/pin.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 1. the math ----------
console.log("\n-- the math --");
check("recipe cost: amount x unit cost, to the cent", T.recipeCost([{ ingredientId: "a", quantity: 2, unitCost: 1.2345 }, { ingredientId: "b", quantity: 0.1, unitCost: 0.5 }]) === 2.52);
check("recipe cost: one ingredient with no cost means no cost", T.recipeCost([{ ingredientId: "a", quantity: 2, unitCost: 1.2 }, { ingredientId: "b", quantity: 1, unitCost: null }]) === null);
check("recipe cost: no recipe lines means no cost", T.recipeCost([]) === null && T.recipeCost(null) === null);
const shuffled = [{ ingredientId: "c", quantity: 0.75, unitCost: 0.8333 }, { ingredientId: "a", quantity: 1.5, unitCost: 0.4167 }, { ingredientId: "b", quantity: 0.25, unitCost: 2.1 }];
check("recipe cost: the same whatever order the ingredients come in", T.recipeCost(shuffled) === T.recipeCost([...shuffled].reverse()));

const beer = { price: 5, cost: 1.1 };
check("a menu item with a full recipe cost is at cost", same(T.ownerLinePrice({ menuItemId: "beer", unit: 5 }, beer), { unit: 1.1, how: "cost" }));
check("no cost on file: half the menu price", same(T.ownerLinePrice({ menuItemId: "nachos", unit: 9 }, { price: 9, cost: null }), { unit: 4.5, how: "half" }));
check("half of an odd price rounds to the cent", T.ownerLinePrice({ menuItemId: "x", unit: 5.75 }, { price: 5.75, cost: null }).unit === 2.88);
check("an add-on on a costed item is charged at half (cost + half of the $1 option)", same(T.ownerLinePrice({ menuItemId: "of", unit: 12 }, { price: 11, cost: 2.57 }), { unit: 3.07, how: "cost" }));
check("an option that takes money off takes half of it off", T.ownerLinePrice({ menuItemId: "x", unit: 4 }, { price: 5, cost: 2 }).unit === 1.5);
check("never more than the menu price, even if the recipe costs more", same(T.ownerLinePrice({ menuItemId: "slider", unit: 4 }, { price: 4, cost: 6 }), { unit: 4, how: "cost" }));
check("never below nothing", T.ownerLinePrice({ menuItemId: "x", unit: 0 }, { price: 3, cost: 0.2 }).unit === 0);
check("a movie ticket is its normal price", same(T.ownerLinePrice({ menuItemId: null, screeningId: "s1", unit: 12 }, null), { unit: 12, how: "menu" }));
check("a custom item is its normal price", same(T.ownerLinePrice({ menuItemId: null, unit: 10 }, null), { unit: 10, how: "menu" }));
check("an item missing from the costs is half of what it was rung at", same(T.ownerLinePrice({ menuItemId: "gone", unit: 6 }, undefined), { unit: 3, how: "half" }));
check("a price built up option by option a hair off still prices the same", T.ownerLinePrice({ menuItemId: "x", unit: 4.5 + 0.1 + 0.2 }, { price: 4.5, cost: 1.2 }).unit === T.ownerLinePrice({ menuItemId: "x", unit: 4.8 }, { price: 4.5, cost: 1.2 }).unit);

const ot = T.ownerOrderTotals([
  { unit: 1.1, qty: 2 },
  { unit: 3.07, qty: 1 },
  { unit: 4.5, qty: 1 },
]);
check("owner order: taxed at 8.725% on the owner prices", ot.subtotal === 9.77 && ot.tax === 0.85 && ot.total === 10.62, JSON.stringify(ot));
check("owner order: nothing else comes off", ot.discount === 0 && ot.tierDiscount === 0 && ot.monthlyDiscount === 0 && ot.redemptionDiscount === 0 && ot.dailyPerkDiscount === 0);
const plusLines = [{ unit: 3, qty: 1, perkBase: 3 }, { unit: 10, qty: 1 }];
const asMember = T.registerTotals(plusLines, { tier: "Insiders+", points: 500 }, true, false, true, true);
const asOwner = T.ownerOrderTotals(plusLines);
check("no stacking: an Insiders+ member's 10%, the monthly 10%, a reward and the daily coffee all come off a normal sale...", asMember.discount > 0 && asMember.dailyPerkDiscount === 3 && asMember.redemptionDiscount > 0);
check("...and none of them come off at the owner rate", asOwner.discount === 0 && asOwner.subtotal === 13 && asOwner.canRedeem === false);
check("no points: an owner order has nothing a member could earn on (no member on it)", asOwner.canRedeem === false);

// A line rung at an old price is caught: sent lines are as rung (menu
// price each), the server's carry today's menu price.
const figured = { lines: [{ name: "Bud Light", unit_price: 5, quantity: 2 }], totals: { subtotal: 2.2, tax: 0.19, total: 2.39 } };
const pricedFig = { lines: [{ menu_unit_price: 5 }], totals: { subtotal: 2.2, tax: 0.19, total: 2.39 } };
check("matching register figures: no problems", T.ownerSaleProblems(figured, pricedFig).length === 0);
check("a cent of rounding is allowed", T.ownerSaleProblems({ ...figured, totals: { ...figured.totals, tax: 0.2 } }, pricedFig).length === 0);
check("a stale rung price is named, to take off and ring again", T.ownerSaleProblems({ ...figured, lines: [{ name: "Bud Light", unit_price: 4.5, quantity: 2 }] }, pricedFig).some((p) => p.includes("Bud Light") && /ring it again/.test(p) && !/PIN/.test(p)));
check("a register total that doesn't match is a problem", T.ownerSaleProblems({ ...figured, totals: { subtotal: 1, tax: 0.09, total: 1.09 } }, pricedFig).length === 1);
check("missing totals are a problem, not a pass", T.ownerSaleProblems({ ...figured, totals: {} }, pricedFig).length === 1);
check("a missing line is a problem", T.ownerSaleProblems({ ...figured, lines: [] }, pricedFig).length >= 1);

// Normal sales, pinned (the same figures as before the owner rate; a
// random comparison against the previous version found no difference).
const g = (...a) => T.registerTotals(...a);
const samePlain = (a, b) => same(a, { subtotal: b.subtotal, orgCompDiscount: 0, taxIncluded: false, ...b });
check("normal sale: plain order", samePlain(g([{ unit: 5, qty: 2 }, { unit: 3.5, qty: 1 }], null, false, false, false, false), { subtotal: 13.5, dailyPerkDiscount: 0, dailyPerkLine: null, tierDiscount: 0, monthlyDiscount: 0, redemptionDiscount: 0, discount: 0, tax: 1.18, total: 14.68, canRedeem: false }));
check("normal sale: Insiders+ 10% and a $5 reward", samePlain(g([{ unit: 10, qty: 1 }], { tier: "Insiders+", points: 150 }, false, false, true, false), { subtotal: 10, dailyPerkDiscount: 0, dailyPerkLine: null, tierDiscount: 1, monthlyDiscount: 0, redemptionDiscount: 5, discount: 6, tax: 0.35, total: 4.35, canRedeem: true }));
check("normal sale: the daily coffee first, then 10%", samePlain(g([{ unit: 3.75, qty: 1, perkBase: 3 }, { unit: 6, qty: 1 }], { tier: "Insiders+", points: 0 }, false, false, false, true), { subtotal: 9.75, dailyPerkDiscount: 3, dailyPerkLine: 0, tierDiscount: 0.68, monthlyDiscount: 0, redemptionDiscount: 0, discount: 3.68, tax: 0.53, total: 6.6, canRedeem: false }));
check("normal sale: monthly member 10%", samePlain(g([{ unit: 8, qty: 3 }], null, true, false, false, false), { subtotal: 24, dailyPerkDiscount: 0, dailyPerkLine: null, tierDiscount: 0, monthlyDiscount: 2.4, redemptionDiscount: 0, discount: 2.4, tax: 1.88, total: 23.48, canRedeem: false }));
check("normal sale: points still 1 per $1 after discounts", T.pointsEarned({ subtotal: 10, tier_discount: 1, monthly_discount: 0, redemption_discount: 5 }) === 4);
check("receipt label is plain ASCII for the printer", /^[\x20-\x7e]+$/.test(T.ownerTabReceiptLabel("Andrew")) && T.ownerTabReceiptLabel("Andrew") === "Owner tab - Andrew - at cost");
// Bar Book and custom drinks, Double, and what the owner rate can't carry.
const cost = (lines) => PRICING.drinkCost(lines);
const costed = cost([{ name: "Bourbon", quantity: 2, unitCost: 1.5 }, { name: "Vermouth", quantity: 0.5, unitCost: 0.4 }]);
const uncosted = cost([{ name: "Bourbon", quantity: 2, unitCost: 1.5 }, { name: "Mystery", quantity: 1, unitCost: null }]);
check("an off-menu drink with every ingredient costed is at cost", same(T.ownerOffMenuPrice(12, costed), { unit: 3.2, how: "cost" }));
check("...with an ingredient uncosted it's half of what it was rung at", same(T.ownerOffMenuPrice(10, uncosted), { unit: 5, how: "half" }));
check("...with no recipe cost at all, half too", same(T.ownerOffMenuPrice(9, null), { unit: 4.5, how: "half" }) && same(T.ownerOffMenuPrice(9, cost([])), { unit: 4.5, how: "half" }));
check("an off-menu drink is never more than it was rung at", T.ownerOffMenuPrice(2, costed).unit === 2);
check("a double on an off-menu drink is half (its second pour isn't in the recipe's cost)", same(T.ownerOffMenuPrice(20, costed, true), { unit: 10, how: "half" }));
check("a Double on a menu item: the upcharge is charged at half (cost + half of $4)", same(T.ownerLinePrice({ menuItemId: "bud", unit: 9 }, { price: 5, cost: 1.1 }), { unit: 3.1, how: "cost" }));
check("a Neat or Rocks upcharge on an item with no cost: half price + half of the $2", same(T.ownerLinePrice({ menuItemId: "shot", unit: 9 }, { price: 7, cost: null }), { unit: 4.5, how: "half" }));
check("the owner order is taxed the plain way: no org comps, no tax inside the price", (() => { const t = T.ownerOrderTotals([{ unit: 10, qty: 1 }]); return t.orgCompDiscount === 0 && t.taxIncluded === false && t.tax === 0.87 && t.total === 10.87; })());
check("an owner-rate order refuses an organization's comp", /comp/.test(T.ownerOrderExtras({ orgComps: 1 }) ?? ""));
check("...and tax-included pricing", /Tax-included/.test(T.ownerOrderExtras({ taxIncluded: true }) ?? ""));
check("...and member perks and tax-free", !!T.ownerOrderExtras({ memberId: "m1" }) && !!T.ownerOrderExtras({ monthlyMember: true }) && !!T.ownerOrderExtras({ pointsRedeemed: true }) && !!T.ownerOrderExtras({ taxFree: true }));
check("a clean owner order carries none of them", T.ownerOrderExtras({ memberId: null, monthlyMember: false, pointsRedeemed: false, taxFree: false, orgComps: 0, taxIncluded: false }) === null);
check("register label reads Owner tab · Andrew · at cost", T.ownerTabLabel("Andrew") === "Owner tab · Andrew · at cost");

// ---------- 2. the owner's PIN approval ----------
console.log("\n-- the approval --");
const A = "a0000000-0000-4000-8000-00000000000a";
const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const H1 = "aGFzaDEtaGFzaDEtaGFzaDE";
const H2 = "aGFzaDItaGFzaDItaGFzaDI";
const LOGIN = staff.employeeId;
const t0 = 1_800_000_000_000;
const sc = (o, n, h = H1) => T.ownerRateScope(o, n, h);
const tok = tokens.sealApproval(sc(A, N1), LOGIN, A, T.OWNER_RATE_APPROVAL_MS, t0);
check("an approval opens for that owner, order and login", tokens.openApproval(tok, sc(A, N1), LOGIN, t0 + 1000)?.approverId === A);
check("the scope reads back: owner, nonce and the order's hash", same(T.parseOwnerRateScope(sc(A, N1)), { ownerId: A, nonce: N1, orderHash: H1 }));
check("not for a changed order (another hash)", tokens.openApproval(tok, sc(A, N1, H2), LOGIN, t0 + 1000) === null);
check("not for another order", tokens.openApproval(tok, sc(A, N2), LOGIN, t0 + 1000) === null);
check("not for another owner", tokens.openApproval(tok, sc("b0000000-0000-4000-8000-00000000000b", N1), LOGIN, t0 + 1000) === null);
check("not from another sign-in", tokens.openApproval(tok, sc(A, N1), "someone-else", t0 + 1000) === null);
check("not after 10 minutes", tokens.openApproval(tok, sc(A, N1), LOGIN, t0 + 10 * 60_000 + 1) === null);
check("not if it's been edited", tokens.openApproval(`${tok.split(".")[0]}x.${tok.split(".")[1]}`, sc(A, N1), LOGIN, t0 + 1000) === null);

// ---------- 3. the register's server side, against the fakes ----------
console.log("\n-- the register (fakes) --");
const E = { andrew: A, nathan: "a0000000-0000-4000-8000-00000000000b", mary: "a0000000-0000-4000-8000-00000000000c", cashier: "a0000000-0000-4000-8000-00000000000d" };
db.employees.push(
  { id: E.andrew, name: "Andrew Clanton", role: "owner", active: true, owner_rate: true, pin_hash: hashPin("2468"), pin_must_change: false },
  { id: E.nathan, name: "Nathan Example", role: "owner", active: true, owner_rate: true, pin_hash: DEFAULT_PIN_HASH, pin_must_change: false },
  { id: E.mary, name: "Mary Example", role: "owner", active: true, owner_rate: false, pin_hash: hashPin("1357"), pin_must_change: false },
  { id: E.cashier, name: "Casey Cashier", role: "cashier", active: true, owner_rate: false, pin_hash: hashPin("8642"), pin_must_change: false },
);
const M = { beer: "b0000000-0000-4000-8000-000000000001", oldf: "b0000000-0000-4000-8000-000000000002", popcorn: "b0000000-0000-4000-8000-000000000003", nachos: "b0000000-0000-4000-8000-000000000004" };
db.menu_items.push(
  { id: M.beer, name: "Bud Light", price: 5, is_alcohol: true, category_id: "cat-1" },
  { id: M.oldf, name: "Old Fashioned", price: 11, is_alcohol: true, category_id: "cat-1" },
  { id: M.popcorn, name: "Popcorn (large)", price: 7.5, is_alcohol: false, category_id: "cat-2" },
  { id: M.nachos, name: "Nachos", price: 9, is_alcohol: false, category_id: "cat-2" },
);
db.menu_modifier_groups.push(
  { id: "g1", item_id: M.oldf, label: "Spirit", type: "single", must_choose: false, options: [{ name: "Bourbon", price_delta: 0 }, { name: "Rye", price_delta: 1 }] },
  { id: "g2", item_id: M.popcorn, label: "Extras", type: "multi", must_choose: false, options: [{ name: "Real butter", price_delta: 0.75 }] },
);
const BOOK_OK = "e0000000-0000-4000-8000-000000000001";
const BOOK_NOCOST = "e0000000-0000-4000-8000-000000000002";
const ING_VODKA = "f0000000-0000-4000-8000-000000000001";
db.ingredients.push(
  { id: "i-can", unit_cost: 1.1 },
  { id: "i-bourbon", unit_cost: 1.2345 },
  { id: "i-bitters", unit_cost: 0.5 },
  { id: "i-sugar", unit_cost: 0.05 },
  { id: "i-kernels", unit_cost: null },
  { id: ING_VODKA, name: "Vodka", unit: "oz", family: "spirit", kind: "spirit", unit_cost: 1 },
);
// cost_complete: a manager ticked "Recipe cost is complete" (popcorn is ticked, but one ingredient has no cost).
db.recipes.push(
  { menu_item_id: M.beer, cost_complete: true, lines: [{ ingredient_id: "i-can", quantity: 1 }] },
  { menu_item_id: M.oldf, cost_complete: true, lines: [{ ingredient_id: "i-bourbon", quantity: 2 }, { ingredient_id: "i-bitters", quantity: 0.1 }, { ingredient_id: "i-sugar", quantity: 1 }] },
  { menu_item_id: M.popcorn, cost_complete: true, lines: [{ ingredient_id: "i-kernels", quantity: 1 }] },
  // Bar Book drinks (off the menu): one fully costed, one with an ingredient that has no cost.
  { id: BOOK_OK, name: "Boulevardier", menu_item_id: null, ingredients: [{ quantity: 2, optional: false, ingredient: { name: "Bourbon", unit_cost: 1.5 } }, { quantity: 0.5, optional: false, ingredient: { name: "Sweet vermouth", unit_cost: 0.4 } }] },
  { id: BOOK_NOCOST, name: "Mystery Sour", menu_item_id: null, ingredients: [{ quantity: 2, optional: false, ingredient: { name: "Bourbon", unit_cost: 1.5 } }, { quantity: 1, optional: false, ingredient: { name: "Lemon", unit_cost: null } }] },
);
const SHOW = "c0000000-0000-4000-8000-000000000001";
db.screenings.push({ id: SHOW, ticket_price: 12 });

const ownerActions = await load("app/pos/owner-rate-actions.ts");
const posActions = await load("app/pos/actions.ts");
const server = await load("lib/owner-rate-server.ts");

// The order as the register rings it: menu prices, options in.
const rung = [
  { menu_item_id: M.beer, name: "Bud Light", unit_price: 5, quantity: 2, modifiers: [], is_alcohol: true, screening_id: null },
  { menu_item_id: M.oldf, name: "Old Fashioned", unit_price: 12, quantity: 1, modifiers: ["Rye"], is_alcohol: true, screening_id: null },
  { menu_item_id: M.popcorn, name: "Popcorn (large)", unit_price: 8.25, quantity: 1, modifiers: ["Real butter"], is_alcohol: false, screening_id: null },
  { menu_item_id: M.nachos, name: "Nachos", unit_price: 9, quantity: 1, modifiers: [], is_alcohol: false, screening_id: null },
  { menu_item_id: null, name: "Clue (7:00 PM)", unit_price: 12, quantity: 1, modifiers: [], is_alcohol: false, screening_id: SHOW },
  { menu_item_id: null, name: "Corkage", unit_price: 10, quantity: 1, modifiers: [], is_alcohol: false, screening_id: null },
];
const priced = await server.priceOwnerSale(rung);
const total = priced.ok ? priced.totals.total : 0;
const approve = (id, pin, lines = rung, shown = total) => ownerActions.approveOwnerRate(id, pin, lines, shown);
check("the server prices the order at cost, cost + half an add-on, half, half, ticket and custom as rung", priced.ok && same(priced.lines.map((l) => l.unit_price), [1.1, 3.07, 4.13, 4.5, 12, 10]), JSON.stringify(priced.ok ? priced.lines.map((l) => l.unit_price) : priced.problems));
check("each line says how it was priced (a ticked recipe with an uncosted ingredient is half)", priced.ok && same(priced.lines.map((l) => l.owner_pricing), ["cost", "cost", "half", "half", "menu", "menu"]));
check("menu value: what the order would have been, taxed at the owner prices", priced.ok && priced.menuValue === 61.25 && priced.totals.subtotal === 35.9 && priced.totals.tax === 3.13 && priced.totals.total === 39.03, JSON.stringify(priced.ok && priced.totals));
const rc = db.recipes.find((r) => r.menu_item_id === M.beer);
rc.cost_complete = false;
const unticked = await server.priceOwnerSale([rung[0]]);
rc.cost_complete = true;
check("the half-price fallback: a recipe nobody ticked complete isn't charged at cost", unticked.ok && unticked.lines[0].unit_price === 2.5 && unticked.lines[0].owner_pricing === "half");
const ticketOnly = await server.priceOwnerSale([rung[4]]);
check("a ticket is charged at its full price", ticketOnly.ok && ticketOnly.lines[0].unit_price === 12 && ticketOnly.lines[0].owner_pricing === "menu");
const src2 = (await import("node:fs")).readFileSync(path.join(src, "lib/owner-rate-server.ts"), "utf8");
check("a menu line's options, Double, Neat and Rocks are priced like any sale (menuLinePrice), then half of the add-ons", /menuLinePrice\(item, itemGroups, mods, doubles\)/.test(src2) && /options \/ 2/.test((await import("node:fs")).readFileSync(path.join(src, "lib/register-totals.ts"), "utf8")));

// Bar Book and custom drinks.
const drink = (name, unit_price, extra = {}) => ({ menu_item_id: null, name, unit_price, quantity: 1, modifiers: [], is_alcohol: true, screening_id: null, ...extra });
const bookLines = [
  drink("Boulevardier", 12, { recipe_id: BOOK_OK }),
  drink("Mystery Sour", 10, { recipe_id: BOOK_NOCOST }),
  drink("Boulevardier (double)", 20, { recipe_id: BOOK_OK, modifiers: ["Double"] }),
  drink("Custom spritz", 9, { custom_recipe: [{ ingredient_id: ING_VODKA, quantity: 1.5 }] }),
  drink("Not a real recipe", 8, { recipe_id: "e0000000-0000-4000-8000-0000000000ff" }),
];
const bookPriced = await server.priceOwnerSale(bookLines);
check("a Bar Book drink with every ingredient costed is at cost; one with an uncosted ingredient is half; a double is half", bookPriced.ok && same(bookPriced.lines.slice(0, 3).map((l) => [l.unit_price, l.owner_pricing]), [[3.2, "cost"], [5, "half"], [10, "half"]]), JSON.stringify(bookPriced.ok ? bookPriced.lines.map((l) => l.unit_price) : bookPriced.problems));
check("a custom drink costed from what's in it is at cost", bookPriced.ok && bookPriced.lines[3].unit_price === 1.5 && bookPriced.lines[3].owner_pricing === "cost");
check("a recipe the server doesn't know is a plain custom line, charged as rung", bookPriced.ok && bookPriced.lines[4].unit_price === 8 && bookPriced.lines[4].owner_pricing === "menu" && !bookPriced.lines[4].recipe_id);
check("the recipe and the list ride along on the priced lines", bookPriced.ok && bookPriced.lines[0].recipe_id === BOOK_OK && bookPriced.lines[3].custom_recipe?.[0]?.name === "Vodka");

const freeSeat = await server.priceOwnerSale([{ ...rung[4], unit_price: 0 }]);
check("a free Insiders+ seat can't go on the owner tab (member perks don't stack)", !freeSeat.ok && /free Insiders\+ ticket/.test(freeSeat.problems[0]));
const badge = await server.priceOwnerSale([{ menu_item_id: null, name: "Free popcorn (badge reward)", unit_price: 0, quantity: 1, modifiers: [], is_alcohol: false, screening_id: null }]);
check("a member's badge reward can't go on the owner tab either", !badge.ok && /badge reward/.test(badge.problems[0]));
const gone = await server.priceOwnerSale([{ ...rung[0], menu_item_id: "b0000000-0000-4000-8000-0000000000ff" }]);
check("an item that isn't on the menu can't be priced, so it's refused", !gone.ok);

const wrong = await approve(E.andrew, "1111");
check("a wrong PIN is turned down", !wrong.ok && /Incorrect PIN/.test(wrong.error), wrong.error);
check("...and logged as a wrong try (it counts toward the lock)", db.pin_attempts.some((p) => p.ok === false && p.context === "owner-rate"));
const cashierPin = await approve(E.andrew, "8642");
check("the cashier's own PIN doesn't approve Andrew's owner rate", !cashierPin.ok);
const notTicked = await approve(E.mary, "1357");
check("an owner who isn't ticked doesn't get it, even with her own PIN", !notTicked.ok && /doesn't get the owner rate/.test(notTicked.error));
const shared = await approve(E.nathan, "9999");
check("an owner still on 9999 is turned down (everyone knows it)", !shared.ok && /9999/.test(shared.error));
const wrongTotal = await approve(E.andrew, "2468", rung, total + 1);
check("a total other than the one the PIN box showed isn't approved", !wrongTotal.ok && /not what was shown/.test(wrongTotal.error));
const ok = await approve(E.andrew, "2468");
check("Andrew's own PIN approves Andrew's owner rate, for that order", ok.ok && ok.firstName === "Andrew" && typeof ok.token === "string" && /^[0-9a-f-]{36}$/.test(ok.nonce) && ok.totals.total === total);
check("the approval carries the server's quote: every line at its owner price", ok.ok && same(ok.lines.map((l) => l.unit_price), [1.1, 3.07, 4.13, 4.5, 12, 10]) && ok.menuValue === 61.25);
check("the right PIN is logged with whose it was", db.pin_attempts.some((p) => p.ok === true && p.context === "owner-rate" && p.approver_id === E.andrew));
const hashOf = (lines, t) => server.ownerOrderHash(lines, t);
check("the approval is signed for this order's hash and no other", tokens.openApproval(ok.token, sc(E.andrew, ok.nonce, hashOf(ok.lines, ok.totals.total)), LOGIN)?.approverId === E.andrew && tokens.openApproval(ok.token, sc(E.andrew, ok.nonce, hashOf(ok.lines.map((l, i) => (i === 0 ? { ...l, quantity: 3 } : l)), ok.totals.total)), LOGIN) === null);

const input = (over = {}) => ({
  employeeId: E.cashier,
  memberId: null,
  orderName: "",
  taxFree: false,
  monthlyMember: false,
  pointsRedeemed: false,
  station: null,
  lines: rung,
  totals: { subtotal: ok.totals.subtotal, tax: ok.totals.tax, total: ok.totals.total },
  ownerRate: { ownerId: E.andrew, token: ok.token, nonce: ok.nonce },
  ageVerified: true,
  draftOrderId: null,
  ...over,
});

const stale = await posActions.completeOwnerTabOrder(input({ lines: rung.map((l, i) => (i === 3 ? { ...l, unit_price: 8 } : l)) }));
check("the stale-price refusal names the line and says take it off and ring it again", !stale.ok && /Nachos/.test(stale.error) && /on the menu now/.test(stale.error) && /ring it again/.test(stale.error) && !/PIN/.test(stale.error), stale.ok ? "" : stale.error);
check("...and nothing was saved", db.orders.length === 0);
const lowTotal = await posActions.completeOwnerTabOrder(input({ totals: { subtotal: 1, tax: 0.09, total: 1.09 } }));
check("register totals that don't match are refused", !lowTotal.ok && db.orders.length === 0);
const bigger = await posActions.completeOwnerTabOrder(input({ lines: rung.map((l, i) => (i === 0 ? { ...l, quantity: 3 } : l)) }));
check("the approval is bound to the order: one more beer than the owner saw is refused", !bigger.ok && bigger.again === true && db.orders.length === 0, bigger.ok ? "" : bigger.error);
const forged = await posActions.completeOwnerTabOrder(input({ ownerRate: { ownerId: E.andrew, token: "x.y", nonce: ok.nonce } }));
check("no approval (a made-up token): refused", !forged.ok && forged.again === true);
const borrowed = await posActions.completeOwnerTabOrder(input({ ownerRate: { ownerId: E.nathan, token: ok.token, nonce: ok.nonce } }));
check("Andrew's approval can't put it on Nathan's tab", !borrowed.ok);
const otherOrder = await posActions.completeOwnerTabOrder(input({ ownerRate: { ownerId: E.andrew, token: ok.token, nonce: N2 } }));
check("an approval for another order can't be used for this one", !otherOrder.ok);
const comp = await posActions.completeOwnerTabOrder(input({ orgComps: 1 }));
check("an owner-rate order carrying an organization comp is refused", !comp.ok && /comp/.test(comp.error) && db.orders.length === 0, comp.ok ? "" : comp.error);
const taxIn = await posActions.completeOwnerTabOrder(input({ taxIncluded: true }));
check("...and one carrying tax-included pricing", !taxIn.ok && /Tax-included/.test(taxIn.error) && db.orders.length === 0, taxIn.ok ? "" : taxIn.error);
const withMember = await posActions.completeOwnerTabOrder(input({ memberId: "d0000000-0000-4000-8000-000000000001", pointsRedeemed: true, monthlyMember: true }));
check("...and one carrying a member, a reward or the monthly 10%", !withMember.ok && /Member perks/.test(withMember.error) && db.orders.length === 0, withMember.ok ? "" : withMember.error);
check("still nothing saved", db.orders.length === 0);

const done = await posActions.completeOwnerTabOrder(input());
await flushAfter();
check("Put on owner tab saves the order", done.ok && typeof done.orderNumber === "number" && done.owner === "Andrew", done.ok ? "" : done.error);
const order = db.orders[0];
check("it's on Andrew's tab with no money taken", order?.payment_method === "owner_tab" && order.owner_tab_employee_id === E.andrew && order.payment_cash_amount === 0 && order.payment_card_amount === 0 && order.payment_voucher_amount === 0 && order.stripe_payment_intent_id === null && order.tip === 0);
check("at the server's figures, taxed, with the menu value it replaced", order?.subtotal === 35.9 && order.tax === 3.13 && order.total === 39.03 && order.owner_menu_value === 61.25 && order.tax_free === false && order.status === "completed");
check("no member on it, nothing off: no points, no discount, no reward", order?.member_id === null && order.tier_discount === 0 && order.monthly_discount === 0 && order.redemption_discount === 0 && order.points_redeemed === false);
check("no points were given", db.points_ledger.length === 0);
const items = db.order_items.filter((i) => i.order_id === order?.id);
check("its lines carry the owner price, the menu price and how", items.length === 6 && same(items.map((i) => [i.unit_price, i.menu_unit_price, i.owner_pricing]), [[1.1, 5, "cost"], [3.07, 12, "cost"], [4.13, 8.25, "half"], [4.5, 9, "half"], [12, 12, "menu"], [10, 10, "menu"]]));
check("the ticket's seat is booked at its normal price", db.bookings.some((b) => b.order_id === order?.id && b.screening_id === SHOW && b.unit_price === 12 && b.member_id === null));

const again = await posActions.completeOwnerTabOrder(input());
check("a repeat of the same approval finds the same order (never two)", again.ok && again.orderNumber === done.orderNumber && db.orders.length === 1);
const different = await posActions.completeOwnerTabOrder(input({ lines: rung.slice(0, 2) }));
check("...but the same approval for a different order is refused", !different.ok && db.orders.length === 1);

// A second order needs a second PIN approval.
const ok2 = await approve(E.andrew, "2468");
const second = await posActions.completeOwnerTabOrder(input({ ownerRate: { ownerId: E.andrew, token: ok2.token, nonce: ok2.nonce } }));
await flushAfter();
check("a second approval makes a second order", second.ok && second.orderNumber !== done.orderNumber && db.orders.length === 2);
check("no member, nothing off and no points on either", db.orders.every((o) => o.member_id === null && o.redemption_discount === 0 && o.monthly_discount === 0 && o.points_redeemed === false) && db.points_ledger.length === 0);

// A Bar Book order: its recipe is kept, and it isn't a "custom item" dev note.
const notes0 = db.dev_notes.length;
const okBook = await approve(E.andrew, "2468", bookLines, bookPriced.ok ? bookPriced.totals.total : 0);
const bookDone = await posActions.completeOwnerTabOrder(input({ lines: bookLines, totals: okBook.totals, ownerRate: { ownerId: E.andrew, token: okBook.token, nonce: okBook.nonce } }));
await flushAfter();
const bookItems = db.order_items.filter((i) => i.order_id === db.orders[2]?.id);
check("a Bar Book order goes on the tab at cost or half, keeping its recipe and list", bookDone.ok && same(bookItems.map((i) => i.unit_price), [3.2, 5, 10, 1.5, 8]) && bookItems[0].recipe_id === BOOK_OK && bookItems[3].custom_recipe?.[0]?.ingredient_id === ING_VODKA, bookDone.ok ? "" : bookDone.error);
check("a Bar Book drink isn't a 'custom item' dev note (the book described it); a plain or list custom line still is", db.dev_notes.length === notes0 + 1 && /Not a real recipe/.test(db.dev_notes.at(-1).message) && /Custom spritz\W+\(vodka 1\.5 oz\)/.test(db.dev_notes.at(-1).message) && !/Boulevardier|Mystery Sour/.test(db.dev_notes.at(-1).message), JSON.stringify(db.dev_notes.slice(notes0).map((n) => n.message)));

const viaPay = await posActions.completeOrder({
  employeeId: E.cashier,
  memberId: null,
  orderName: "",
  taxFree: false,
  monthlyMember: false,
  pointsRedeemed: false,
  station: null,
  lines: rung,
  totals: { subtotal: 1, tax: 0.09, total: 1.09, tier_discount: 0, monthly_discount: 0, redemption_discount: 0 },
  payment: { method: "owner_tab", cash: 0, card: 0 },
  ageVerified: true,
});
check("the ordinary checkout refuses 'owner_tab' (only the owner's approval can make one)", !viaPay.ok && db.orders.length === 3);

const late = tokens.sealApproval(sc(E.andrew, N2), staff.employeeId, E.andrew, -1);
const expired = await posActions.completeOwnerTabOrder(input({ ownerRate: { ownerId: E.andrew, token: late, nonce: N2 } }));
check("a run-out approval is refused", !expired.ok && expired.again === true && /run out/.test(expired.error));

// ---------- 4. reports ----------
console.log("\n-- reports --");
const reports = await load("lib/data/reports.ts");
const ownerTabData = await load("lib/data/owner-tab.ts");
const at = "2026-10-03T01:00:00Z"; // Oct 2, 8 p.m. Central
const row = (o) => ({
  id: o.id,
  order_number: o.n,
  status: "completed",
  source: "pos",
  completed_at: at,
  order_name: null,
  tab_name: null,
  payment_method: o.method,
  payment_cash_amount: o.cash ?? 0,
  payment_card_amount: o.card ?? 0,
  payment_voucher_amount: 0,
  subtotal: o.subtotal,
  tax: o.tax,
  tax_free: false,
  tip: 0,
  total: o.total,
  tier_discount: 0,
  monthly_discount: 0,
  redemption_discount: 0,
  daily_perk_discount: 0,
  owner_tab_employee_id: o.owner ?? null,
  owner_menu_value: o.menuValue ?? null,
  stripe_payment_intent_id: null,
  employee_id: null,
  employee: null,
  items: o.items,
});
const salesRows = {
  orders: [
    // A customer's $10 of beer, cash.
    row({ id: "o1", n: 1, method: "cash", cash: 10.87, subtotal: 10, tax: 0.87, total: 10.87, items: [{ name: "Bud Light", quantity: 2, unit_price: 5, modifiers: [], menu_item_id: M.beer, is_alcohol: true, screening_id: null }] }),
    // Andrew's two beers at cost and a $12 ticket, on his tab.
    row({
      id: "o2",
      n: 2,
      method: "owner_tab",
      owner: E.andrew,
      subtotal: 14.2,
      tax: 1.24,
      total: 15.44,
      menuValue: 22,
      items: [
        { name: "Bud Light", quantity: 2, unit_price: 1.1, modifiers: [], menu_item_id: M.beer, is_alcohol: true, screening_id: null },
        { name: "Clue", quantity: 1, unit_price: 12, modifiers: [], menu_item_id: null, is_alcohol: false, screening_id: SHOW },
      ],
    }),
  ],
  bookings: [{ quantity: 1, unit_price: 12, tax_amount: 0, order_id: "o2", created_at: at, screening_id: SHOW }],
  booths: [],
  partials: [],
  memberships: [],
  membershipsTracked: true,
  // Nathan paid last month's statement today.
  ownerPayments: [{ owner_id: E.nathan, month: "2026-09", amount: 40, method: "check", created_at: at }],
};
const buckets = new Map([[M.beer, "liquor"]]);
const s = reports.summarizeSales(salesRows, buckets);
check("money in: the customer's cash and Nathan's payment, not Andrew's tab", Math.abs(s.collected - (10.87 + 40)) < 0.001 && s.cash === 10.87 && s.card === 0, `collected ${s.collected}`);
check("the owner tab is its own line in what sold, at what the owners pay (the ticket counted once, with tickets)", s.sold.find((x) => x.label === "Owner tab")?.amount === 2.2 && s.sold.find((x) => x.label === "Movie tickets")?.amount === 12);
check("the owner tab line shows the menu value it replaced", /menu value \$10\.00/.test(s.sold.find((x) => x.label === "Owner tab")?.detail ?? ""), s.sold.find((x) => x.label === "Owner tab")?.detail);
check("Alcohol is the customers' beer only (no double count)", s.sold.find((x) => x.label === "Alcohol")?.amount === 10);
check("net sales: customer goods + ticket + owner goods at cost", Math.abs(s.netSales - (10 + 12 + 2.2)) < 0.001, String(s.netSales));
check("sales tax includes the tax owed on the tab", Math.abs(s.tax - (0.87 + 1.24)) < 0.001 && s.ownerTab.tax === 1.24);
check("owner tab summary: owed, menu value, paid", s.ownerTab.orders === 1 && s.ownerTab.owed === 15.44 && s.ownerTab.menuValue === 10 && s.ownerTab.sales === 2.2 && s.ownerTab.paid === 40 && s.ownerTab.payments === 1);
check("Nathan's food-and-drink split leaves the owner tab out (no money came in)", Math.abs(s.accounts.find((a) => a.label === "Inventory").amount - 10 * 0.2) < 0.001);
const byDay = reports.salesByDay(salesRows);
check("a payment counts on the day it was recorded", byDay.get("2026-10-02")?.ownerPayments.length === 1);

check("statement: this month is still running", ownerTabData.monthStatus("2026-10", "2026-10", 50, 0) === "running");
check("statement: paid in full is settled", ownerTabData.monthStatus("2026-09", "2026-10", 50, 50) === "settled");
check("statement: part paid", ownerTabData.monthStatus("2026-09", "2026-10", 50, 20) === "part");
check("statement: nothing paid", ownerTabData.monthStatus("2026-09", "2026-10", 50, 0) === "unpaid");
check("statement: paid more than owed (an order refunded after it was paid)", ownerTabData.monthStatus("2026-09", "2026-10", 30, 50) === "credit");
check("a business month starts at 4 a.m. on the 1st", ownerTabData.businessMonth("2026-10-01T08:30:00Z") === "2026-09" && ownerTabData.businessMonth("2026-10-01T09:30:00Z") === "2026-10");

// Box office ($4 a paid ticket) leaves tickets on owner tabs out.
const findLabel = (v, label) => {
  if (!v || typeof v !== "object") return undefined;
  if (v.label === label) return v;
  for (const x of Object.values(v)) {
    const r = findLabel(x, label);
    if (r) return r;
  }
  return undefined;
};
const box = findLabel(s, "Box office");
check("Box office: the ticket on Andrew's tab isn't a paid box office ticket", box && box.amount === 0, JSON.stringify(box));
const s2 = reports.summarizeSales({ ...salesRows, bookings: [...salesRows.bookings, { quantity: 1, unit_price: 12, tax_amount: 0, order_id: "o1", created_at: at, screening_id: SHOW }] }, buckets);
const box2 = findLabel(s2, "Box office");
check("...and a customer's ticket beside it is $4", box2 && box2.amount === 4 && /\$4 × 1 paid ticket/.test(box2.rule) && /1 on owner tabs/.test(box2.rule), JSON.stringify(box2));

// Who sees the owner tab: owners only; everyone else gets "Owner tab" and its totals.
const dayOrder = { id: "o2", orderNumber: 2, status: "completed", items: "Bud Light x2, Clue", method: "owner_tab", tip: 0, total: 15.44, refunded: 0, refundable: 0, tax: 1.24, cash: 0, card: 0, voucher: 0, refundedTax: 0, refundedCard: 0, refundedCash: 0, lines: [{ name: "Bud Light", qty: 2, amount: 2.2, category: "Owner tab" }], ownerTab: "Andrew" };
const hidden = reports.redactOwnerOrder(dayOrder);
check("a manager or admin sees an owner-tab order as 'Owner tab': no name, no lines, no amounts", hidden.ownerTab !== "Andrew" && !!hidden.ownerTab && hidden.lines.length === 0 && hidden.total === 0 && hidden.items === "Owner tab" && !JSON.stringify(hidden).includes("Andrew") && !JSON.stringify(hidden).includes("Bud Light"));
const plainOrder = { ...dayOrder, id: "o1", method: "cash", ownerTab: null, total: 10.87 };
check("an ordinary order is left alone", reports.redactOwnerOrder(plainOrder) === plainOrder);
check("only an owner may look: the default, a manager and an admin are all redacted", reports.mayViewOwnerTab({ role: "owner" }) && !reports.mayViewOwnerTab(undefined) && !reports.mayViewOwnerTab({ role: "manager" }) && !reports.mayViewOwnerTab({ role: "admin" }));
const rsrc = (await import("node:fs")).readFileSync(path.join(src, "lib/data/reports.ts"), "utf8");
check("the Day report and the order lookup redact where they read (not in the page)", /seeOwners \? order : redactOwnerOrder\(order\)/.test(rsrc) && /mayViewOwnerTab\(viewer\) \? order : redactOwnerOrder\(order\)/.test(rsrc) && /seeOwners \? \[\.\.\.rows\.ownerPayments\] : \[\]/.test(rsrc));
check("the owner tab pages' readers refuse anyone who isn't an owner", (await ownerTabData.getOwnerTabOverview({ role: "manager" }).then(() => false, () => true)) && (await ownerTabData.getOwnerStatement({ role: "admin" }, E.andrew, "2026-09").then(() => false, () => true)) && (await ownerTabData.ownerTabThisMonth({ role: "manager" })) === null);

// The nightly email: owner-tab orders out of the count, the money and the average; one line of their own.
const digestEmail = await load("lib/email/daily-digest-email.ts");
const ownerDay = { ...s, membershipLines: [], ownerPaymentLines: [], ticketLines: [], boothLines: [], orders: [{ ...plainOrder }, { ...dayOrder }, { ...dayOrder, id: "o3", orderNumber: 3, status: "refunded" }], ticketsSold: 1 };
check("the subject counts 1 order, not the owner's", /, 1 order,/.test(digestEmail.dailyDigestSubject({ label: "Friday", day: ownerDay })), digestEmail.dailyDigestSubject({ label: "Friday", day: ownerDay }));
// Anything the email reads that this check doesn't care about is an empty list.
const digestOf = (day) => new Proxy({ label: "Friday, Oct 2", day, lastWeek: null, weekdayAverage: null, next: { items: [] } }, { get: (t, k) => (k in t ? t[k] : []) });
const html = (() => {
  try {
    return digestEmail.dailyDigestHtml(digestOf(ownerDay), "https://example.test/report");
  } catch (e) {
    return `ERROR ${e.message}`;
  }
})();
check("the email says '1 order' and gives the owner tab its own line: 1 order, $2.20 at cost", /1 order ·/.test(html) && /Owner tab: 1 order, \$2\.20 at cost/.test(html), html.startsWith("ERROR") ? html : "");
check("the average is the customer's order alone ($10.87), not diluted by the owner's", /\$10\.87 average/.test(html));
const noOwner = digestEmail.dailyDigestHtml(digestOf({ ...ownerDay, ownerTab: { ...ownerDay.ownerTab, orders: 0, sales: 0, owed: 0, menuValue: 0, tax: 0 }, orders: [plainOrder] }), "https://example.test/report");
check("with no owner-tab orders the line isn't there", !/Owner tab: /.test(noOwner));
const dsrc = (await import("node:fs")).readFileSync(path.join(src, "lib/data/daily-digest.ts"), "utf8");
check("the refunds line says 'taken off owner tab' for an owner order, with no amount", /taken off owner tab/.test(dsrc) && /status === "refunded" && !o\.ownerTab/.test(dsrc));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll owner tab checks passed.");
process.exit(failures ? 1 : 0);
