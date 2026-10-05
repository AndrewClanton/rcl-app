// Checks the owner rate (cost + 10%, paid at the register) without a database:
//  1. The math (lib/register-totals.ts): a recipe's cost plus 10%, the
//     half-price fallback, options at half, tickets and custom items at
//     their normal price, never more than the menu, the order taxed with
//     nothing else off, and a register price that doesn't match the
//     server's being caught. Normal sales' math pinned to known figures.
//  2. The register's server side against in-memory stand-ins
//     (scripts/check-owner-tab-fakes.mjs): only an owner's own member
//     account (role owner, owner rate on, the same login) gets it;
//     priceOwnerSale; quoteOwnerRate; checkBeforePayment; and completeOrder
//     saving an owner-rate sale paid in cash at the server's prices, with
//     whose account it was, who rang it up and the menu value, and no
//     points; refusing it for anyone else, with perks on, or at a stale
//     price; and refusing 'owner_tab' (the monthly tab is gone).
//  3. Reports: the owner-rate sale is money in and in what sold, with its
//     own "Owner rate" line and who used it; the nightly email the same.
//
// Usage: node scripts/check-owner-tab.mjs   (Node 22.18+ runs the .ts directly)
import { existsSync, readFileSync } from "node:fs";
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
const { db, flushAfter } = fakes;
const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const T = await load("lib/register-totals.ts");
const PRICING = await load("lib/bar/pricing.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 1. the math ----------
console.log("\n-- the math --");
check("the owner rate is one setting: cost + 10%", T.OWNER_RATE_MARKUP === 0.1 && T.OWNER_RATE_NAME === "cost + 10%" && T.ownerCostPrice(10) === 11 && T.ownerCostPrice(1.1) === 1.21);
check("recipe cost: amount x unit cost, to the cent", T.recipeCost([{ ingredientId: "a", quantity: 2, unitCost: 1.2345 }, { ingredientId: "b", quantity: 0.1, unitCost: 0.5 }]) === 2.52);
check("recipe cost: one ingredient with no cost means no cost", T.recipeCost([{ ingredientId: "a", quantity: 2, unitCost: 1.2 }, { ingredientId: "b", quantity: 1, unitCost: null }]) === null);
check("recipe cost: no recipe lines means no cost", T.recipeCost([]) === null && T.recipeCost(null) === null);
const shuffled = [{ ingredientId: "c", quantity: 0.75, unitCost: 0.8333 }, { ingredientId: "a", quantity: 1.5, unitCost: 0.4167 }, { ingredientId: "b", quantity: 0.25, unitCost: 2.1 }];
check("recipe cost: the same whatever order the ingredients come in", T.recipeCost(shuffled) === T.recipeCost([...shuffled].reverse()));

check("a menu item with a full recipe cost is cost + 10%", same(T.ownerLinePrice({ menuItemId: "beer", unit: 5 }, { price: 5, cost: 1.1 }), { unit: 1.21, how: "cost" }));
check("no cost on file: half the menu price (the fallback, unchanged)", same(T.ownerLinePrice({ menuItemId: "nachos", unit: 9 }, { price: 9, cost: null }), { unit: 4.5, how: "half" }));
check("half of an odd price rounds to the cent", T.ownerLinePrice({ menuItemId: "x", unit: 5.75 }, { price: 5.75, cost: null }).unit === 2.88);
check("an add-on on a costed item is charged at half (cost + 10% + half of the $1 option)", same(T.ownerLinePrice({ menuItemId: "of", unit: 12 }, { price: 11, cost: 2.57 }), { unit: 3.33, how: "cost" }));
check("an option that takes money off takes half of it off", T.ownerLinePrice({ menuItemId: "x", unit: 4 }, { price: 5, cost: 2 }).unit === 1.7);
check("never more than the menu price, even if cost + 10% is more", same(T.ownerLinePrice({ menuItemId: "slider", unit: 4 }, { price: 4, cost: 3.9 }), { unit: 4, how: "cost" }));
check("never below nothing", T.ownerLinePrice({ menuItemId: "x", unit: 0 }, { price: 3, cost: 0.2 }).unit === 0);
check("a movie ticket is its normal price", same(T.ownerLinePrice({ menuItemId: null, screeningId: "s1", unit: 12 }, null), { unit: 12, how: "menu" }));
check("a custom item is its normal price", same(T.ownerLinePrice({ menuItemId: null, unit: 10 }, null), { unit: 10, how: "menu" }));
check("an item missing from the costs is half of what it was rung at", same(T.ownerLinePrice({ menuItemId: "gone", unit: 6 }, undefined), { unit: 3, how: "half" }));
check("labels say cost + 10%", T.OWNER_PRICING_LABEL.cost === "at cost + 10%" && T.OWNER_PRICING_TAG.cost === "cost + 10%");

const ot = T.ownerOrderTotals([
  { unit: 1.1, qty: 2 },
  { unit: 3.07, qty: 1 },
  { unit: 4.5, qty: 1 },
]);
check("owner order: taxed at 8.725% on the owner prices", ot.subtotal === 9.77 && ot.tax === 0.85 && ot.total === 10.62, JSON.stringify(ot));
check("owner order: nothing else comes off", ot.discount === 0 && ot.tierDiscount === 0 && ot.monthlyDiscount === 0 && ot.redemptionDiscount === 0 && ot.dailyPerkDiscount === 0);

const figured = { lines: [{ name: "Bud Light", unit_price: 5, quantity: 2 }], totals: { subtotal: 2.42, tax: 0.21, total: 2.63 } };
const pricedFig = { lines: [{ menu_unit_price: 5 }], totals: { subtotal: 2.42, tax: 0.21, total: 2.63 } };
check("matching register figures: no problems", T.ownerSaleProblems(figured, pricedFig).length === 0);
check("a stale rung price is named, to take off and ring again", T.ownerSaleProblems({ ...figured, lines: [{ name: "Bud Light", unit_price: 4.5, quantity: 2 }] }, pricedFig).some((p) => p.includes("Bud Light") && /ring it again/.test(p)));
check("a register total that doesn't match is a problem", T.ownerSaleProblems({ ...figured, totals: { subtotal: 1, tax: 0.09, total: 1.09 } }, pricedFig).length === 1);

const g = (...a) => T.registerTotals(...a);
const samePlain = (a, b) => same(a, { subtotal: b.subtotal, orgCompDiscount: 0, taxIncluded: false, ...b });
check("normal sale: plain order", samePlain(g([{ unit: 5, qty: 2 }, { unit: 3.5, qty: 1 }], null, false, false, false, false), { subtotal: 13.5, dailyPerkDiscount: 0, dailyPerkLine: null, tierDiscount: 0, monthlyDiscount: 0, redemptionDiscount: 0, discount: 0, tax: 1.18, total: 14.68, canRedeem: false }));
check("normal sale: Insiders+ 10% and a $5 reward", samePlain(g([{ unit: 10, qty: 1 }], { tier: "Insiders+", points: 150 }, false, false, true, false), { subtotal: 10, dailyPerkDiscount: 0, dailyPerkLine: null, tierDiscount: 1, monthlyDiscount: 0, redemptionDiscount: 5, discount: 6, tax: 0.35, total: 4.35, canRedeem: true }));

const cost = (lines) => PRICING.drinkCost(lines);
const costed = cost([{ name: "Bourbon", quantity: 2, unitCost: 1.5 }, { name: "Vermouth", quantity: 0.5, unitCost: 0.4 }]);
const uncosted = cost([{ name: "Bourbon", quantity: 2, unitCost: 1.5 }, { name: "Mystery", quantity: 1, unitCost: null }]);
check("an off-menu drink with every ingredient costed is cost + 10%", same(T.ownerOffMenuPrice(12, costed), { unit: 3.52, how: "cost" }));
check("...with an ingredient uncosted it's half of what it was rung at", same(T.ownerOffMenuPrice(10, uncosted), { unit: 5, how: "half" }));
check("an off-menu drink is never more than it was rung at", T.ownerOffMenuPrice(2, costed).unit === 2);
check("a double on an off-menu drink is half", same(T.ownerOffMenuPrice(20, costed, true), { unit: 10, how: "half" }));
check("a Double on a menu item: cost + 10% plus half the $4 upcharge", same(T.ownerLinePrice({ menuItemId: "bud", unit: 9 }, { price: 5, cost: 1.1 }), { unit: 3.21, how: "cost" }));
check("the owner rate refuses an organization's comp", /comp/.test(T.ownerOrderExtras({ orgComps: 1 }) ?? ""));
check("...tax-included pricing and tax exempt", /Tax-included/.test(T.ownerOrderExtras({ taxIncluded: true }) ?? "") && !!T.ownerOrderExtras({ taxFree: true }));
check("...member discounts, the monthly 10%, a reward and the daily coffee", !!T.ownerOrderExtras({ monthlyMember: true }) && !!T.ownerOrderExtras({ pointsRedeemed: true }) && !!T.ownerOrderExtras({ discounts: 1 }));
check("a clean owner order carries none of them (the owner's account on it is fine)", T.ownerOrderExtras({ monthlyMember: false, pointsRedeemed: false, taxFree: false, orgComps: 0, taxIncluded: false, discounts: 0 }) === null);
const line = T.ownerRateLine({ sales: 20, menuValue: 50, who: [{ name: "Andrew", orders: 2 }, { name: "Caleb", orders: 1 }] });
check("the report line: Owner rate: $X at cost + 10%, $Y off menu, and who", line.label === "Owner rate: $20.00 at cost + 10%" && line.value === "$30.00 off menu" && line.who === "Andrew ×2, Caleb");

// ---------- 2. the register's server side, against the fakes ----------
console.log("\n-- the register (fakes) --");
const E = { andrew: "a0000000-0000-4000-8000-00000000000a", mary: "a0000000-0000-4000-8000-00000000000c", cashier: "a0000000-0000-4000-8000-00000000000d", admin: "a0000000-0000-4000-8000-00000000000e" };
const MEM = { andrew: "d0000000-0000-4000-8000-00000000000a", mary: "d0000000-0000-4000-8000-00000000000c", cashier: "d0000000-0000-4000-8000-00000000000d", admin: "d0000000-0000-4000-8000-00000000000e", guest: "d0000000-0000-4000-8000-0000000000ff" };
db.employees.push(
  { id: E.andrew, name: "Andrew Clanton", role: "owner", active: true, owner_rate: true, auth_user_id: "u-andrew" },
  { id: E.mary, name: "Mary Example", role: "owner", active: true, owner_rate: false, auth_user_id: "u-mary" },
  { id: E.cashier, name: "Casey Cashier", role: "cashier", active: true, owner_rate: false, auth_user_id: "u-casey" },
  // Ticked by hand in the database, but not an owner: never gets it.
  { id: E.admin, name: "Adam Admin", role: "admin", active: true, owner_rate: true, auth_user_id: "u-adam" },
);
db.members.push(
  { id: MEM.andrew, name: "Andrew Clanton", auth_user_id: "u-andrew", erased_at: null, points: 0 },
  { id: MEM.mary, name: "Mary Example", auth_user_id: "u-mary", erased_at: null, points: 0 },
  { id: MEM.cashier, name: "Casey Cashier", auth_user_id: "u-casey", erased_at: null, points: 0 },
  { id: MEM.admin, name: "Adam Admin", auth_user_id: "u-adam", erased_at: null, points: 0 },
  { id: MEM.guest, name: "Regular Guest", auth_user_id: null, erased_at: null, points: 0 },
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
const ING_VODKA = "f0000000-0000-4000-8000-000000000001";
db.ingredients.push(
  { id: "i-can", unit_cost: 1.1 },
  { id: "i-bourbon", unit_cost: 1.2345 },
  { id: "i-bitters", unit_cost: 0.5 },
  { id: "i-sugar", unit_cost: 0.05 },
  { id: "i-kernels", unit_cost: null },
  { id: ING_VODKA, name: "Vodka", unit: "oz", family: "spirit", kind: "spirit", unit_cost: 1 },
);
db.recipes.push(
  { menu_item_id: M.beer, cost_complete: true, lines: [{ ingredient_id: "i-can", quantity: 1 }] },
  { menu_item_id: M.oldf, cost_complete: true, lines: [{ ingredient_id: "i-bourbon", quantity: 2 }, { ingredient_id: "i-bitters", quantity: 0.1 }, { ingredient_id: "i-sugar", quantity: 1 }] },
  { menu_item_id: M.popcorn, cost_complete: true, lines: [{ ingredient_id: "i-kernels", quantity: 1 }] },
  { id: BOOK_OK, name: "Boulevardier", menu_item_id: null, ingredients: [{ quantity: 2, optional: false, ingredient: { name: "Bourbon", unit_cost: 1.5 } }, { quantity: 0.5, optional: false, ingredient: { name: "Sweet vermouth", unit_cost: 0.4 } }] },
);
const SHOW = "c0000000-0000-4000-8000-000000000001";
db.screenings.push({ id: SHOW, ticket_price: 12 });

const server = await load("lib/owner-rate-server.ts");
const ownerActions = await load("app/pos/owner-rate-actions.ts");
const posActions = await load("app/pos/actions.ts");

const owners = await server.ownerMembers();
check("only an owner with the owner rate on, through their own member account", same(owners, [{ memberId: MEM.andrew, employeeId: E.andrew, firstName: "Andrew" }]), JSON.stringify(owners));
check("Mary (an owner, not switched on), a cashier and an admin ticked by hand don't get it", (await server.ownerForMember(MEM.mary)) === null && (await server.ownerForMember(MEM.cashier)) === null && (await server.ownerForMember(MEM.admin)) === null && (await server.ownerForMember(null)) === null);
const andrewRow = db.employees.find((e) => e.id === E.andrew);
andrewRow.active = false;
check("an owner who's no longer active doesn't get it", (await server.ownerForMember(MEM.andrew)) === null);
andrewRow.active = true;
db.members.find((m) => m.id === MEM.andrew).erased_at = "2026-10-01T00:00:00Z";
check("nor an erased member account", (await server.ownerForMember(MEM.andrew)) === null);
db.members.find((m) => m.id === MEM.andrew).erased_at = null;

const rung = [
  { menu_item_id: M.beer, name: "Bud Light", unit_price: 5, quantity: 2, modifiers: [], is_alcohol: true, screening_id: null },
  { menu_item_id: M.oldf, name: "Old Fashioned", unit_price: 12, quantity: 1, modifiers: ["Rye"], is_alcohol: true, screening_id: null },
  { menu_item_id: M.popcorn, name: "Popcorn (large)", unit_price: 8.25, quantity: 1, modifiers: ["Real butter"], is_alcohol: false, screening_id: null },
  { menu_item_id: M.nachos, name: "Nachos", unit_price: 9, quantity: 1, modifiers: [], is_alcohol: false, screening_id: null },
  { menu_item_id: null, name: "Clue (7:00 PM)", unit_price: 12, quantity: 1, modifiers: [], is_alcohol: false, screening_id: SHOW },
  { menu_item_id: null, name: "Corkage", unit_price: 10, quantity: 1, modifiers: [], is_alcohol: false, screening_id: null },
];
const priced = await server.priceOwnerSale(rung);
check("the server prices: cost + 10%, cost + 10% + half an add-on, half, half, ticket and custom as rung", priced.ok && same(priced.lines.map((l) => l.unit_price), [1.21, 3.33, 4.13, 4.5, 12, 10]), JSON.stringify(priced.ok ? priced.lines.map((l) => l.unit_price) : priced.problems));
check("each line says how it was priced", priced.ok && same(priced.lines.map((l) => l.owner_pricing), ["cost", "cost", "half", "half", "menu", "menu"]));
check("menu value and the owner totals, taxed", priced.ok && priced.menuValue === 61.25 && priced.totals.subtotal === 36.38 && priced.totals.tax === 3.17 && priced.totals.total === 39.55, JSON.stringify(priced.ok && priced.totals));
const bookPriced = await server.priceOwnerSale([
  { menu_item_id: null, name: "Boulevardier", unit_price: 12, quantity: 1, modifiers: [], is_alcohol: true, screening_id: null, recipe_id: BOOK_OK },
  { menu_item_id: null, name: "Custom spritz", unit_price: 9, quantity: 1, modifiers: [], is_alcohol: true, screening_id: null, custom_recipe: [{ ingredient_id: ING_VODKA, quantity: 1.5 }] },
]);
check("a Bar Book drink and a custom drink costed from what's in it are cost + 10%", bookPriced.ok && same(bookPriced.lines.map((l) => [l.unit_price, l.owner_pricing]), [[3.52, "cost"], [1.65, "cost"]]), JSON.stringify(bookPriced.ok ? bookPriced.lines.map((l) => l.unit_price) : bookPriced.problems));
const freeSeat = await server.priceOwnerSale([{ ...rung[4], unit_price: 0 }]);
check("a free Insiders+ seat doesn't go with the owner rate", !freeSeat.ok && /free Insiders\+ ticket/.test(freeSeat.problems[0]));

const q = await ownerActions.quoteOwnerRate(MEM.andrew, rung);
check("the register's quote for Andrew's account: the server's prices", q.ok && q.firstName === "Andrew" && q.totals.total === 39.55 && q.lines.length === 6);
const qGuest = await ownerActions.quoteOwnerRate(MEM.guest, rung);
const qMary = await ownerActions.quoteOwnerRate(MEM.mary, rung);
const qNone = await ownerActions.quoteOwnerRate(null, rung);
check("no quote for a regular member, an owner not switched on, or no account", !qGuest.ok && !qMary.ok && !qNone.ok && /owner's own account/.test(qGuest.error));

const ownerTotals = { subtotal: 36.38, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, daily_perk_discount: 0, tax: 3.17, total: 39.55 };
const fields = (over = {}) => ({ employeeId: E.cashier, memberId: MEM.andrew, orderName: "", taxFree: false, monthlyMember: false, pointsRedeemed: false, station: null, lines: rung, ownerRate: true, ...over });
check("checkBeforePayment: Andrew's account and the server's figures pass", (await posActions.checkBeforePayment(fields(), ownerTotals)).ok === true);
const cbWrong = await posActions.checkBeforePayment(fields(), { ...ownerTotals, total: 30 });
check("...a total that doesn't match the server's is stopped before payment", !cbWrong.ok && /owner-rate total/.test(cbWrong.error));
const cbGuest = await posActions.checkBeforePayment(fields({ memberId: MEM.guest }), ownerTotals);
check("...and someone else's account on the order is stopped", !cbGuest.ok && /owner's own account/.test(cbGuest.error));

const sale = (over = {}, totals = ownerTotals) => ({ ...fields(over), totals, payment: { method: "cash", cash: totals.total, card: 0 }, ageVerified: true, tip: 0, draftOrderId: null });
const refusals = [
  ["a regular member's account", await posActions.completeOrder(sale({ memberId: MEM.guest }))],
  ["Mary's account (not switched on)", await posActions.completeOrder(sale({ memberId: MEM.mary }))],
  ["no account at all", await posActions.completeOrder(sale({ memberId: null }))],
  ["a points reward on it", await posActions.completeOrder(sale({ pointsRedeemed: true }))],
  ["tax exempt", await posActions.completeOrder(sale({ taxFree: true }))],
  ["a member discount in the totals", await posActions.completeOrder(sale({}, { ...ownerTotals, tier_discount: 1 }))],
  ["an organization comp", await posActions.completeOrder(sale({}, { ...ownerTotals, org_comp_discount: 2 }))],
  ["a stale price (Nachos rung at $8)", await posActions.completeOrder(sale({ lines: rung.map((l, i) => (i === 3 ? { ...l, unit_price: 8 } : l)) }))],
  ["totals lower than the server's", await posActions.completeOrder(sale({}, { ...ownerTotals, subtotal: 30, total: 33.17 }))],
];
for (const [what, r] of refusals) check(`refused, nothing saved: ${what}`, !r.ok && r.cardCharged === false && db.orders.length === 0, r.ok ? "saved" : r.error);

const done = await posActions.completeOrder(sale());
await flushAfter();
const order = db.orders[0];
check("Andrew's owner-rate sale is saved, paid in cash like any order", done.ok && db.orders.length === 1 && order.payment_method === "cash" && order.payment_cash_amount === 39.55 && order.status === "completed", done.ok ? "" : done.error);
check("it keeps whose account it was and who rang it up (and ticked it)", order?.member_id === MEM.andrew && order.employee_id === E.cashier);
check("at the owner totals, taxed, with the menu value it replaced", order?.subtotal === 36.38 && order.tax === 3.17 && order.total === 39.55 && order.owner_menu_value === 61.25 && order.tax_free === false);
check("not a monthly tab: no owner tab on it", !order?.owner_tab_employee_id && order?.payment_method !== "owner_tab");
check("no discounts, no reward", order?.tier_discount === 0 && order.monthly_discount === 0 && order.redemption_discount === 0 && order.points_redeemed === false);
check("no points were given", (db.points_ledger ?? []).length === 0);
const items = db.order_items.filter((i) => i.order_id === order?.id);
check("its lines carry the owner price, the menu price and how", items.length === 6 && same(items.map((i) => [i.unit_price, i.menu_unit_price, i.owner_pricing]), [[1.21, 5, "cost"], [3.33, 12, "cost"], [4.13, 8.25, "half"], [4.5, 9, "half"], [12, 12, "menu"], [10, 10, "menu"]]), JSON.stringify(items.map((i) => [i.unit_price, i.menu_unit_price, i.owner_pricing])));
check("the ticket's seat is booked at its normal price", db.bookings.some((b) => b.order_id === order?.id && b.screening_id === SHOW && b.unit_price === 12));

const plain = await posActions.completeOrder({ ...sale({ memberId: MEM.guest, ownerRate: false }, { subtotal: 61.25, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, tax: 5.34, total: 66.59 }) });
await flushAfter();
const plainOrder = db.orders[1];
check("an ordinary sale beside it saves as before: menu prices, no owner columns", plain.ok && plainOrder?.owner_menu_value === undefined && db.order_items.filter((i) => i.order_id === plainOrder.id).every((i) => i.owner_pricing === undefined));

const viaTab = await posActions.completeOrder({ ...sale(), payment: { method: "owner_tab", cash: 0, card: 0 } });
check("'owner_tab' is refused: the monthly tab is gone", !viaTab.ok && db.orders.length === 2);
const psrc = readFileSync(path.join(src, "app/pos/PosApp.tsx"), "utf8");
check("the register has no always-visible Owner rate button, no PIN box and no Put on owner tab", !/OwnerRateModal|putOnOwnerTab|completeOwnerTabOrder|Put on .*owner tab/.test(psrc) && /isOwnerAccount && \(/.test(psrc));

// ---------- 3. reports ----------
console.log("\n-- reports --");
const reports = await load("lib/data/reports.ts");
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
  owner_tab_employee_id: null,
  owner_menu_value: o.menuValue ?? null,
  stripe_payment_intent_id: null,
  employee_id: null,
  employee: { name: "Casey Cashier" },
  member: o.member ? { name: o.member } : null,
  items: o.items,
});
const salesRows = {
  orders: [
    // A customer's $10 of beer, cash.
    row({ id: "o1", n: 1, method: "cash", cash: 10.87, subtotal: 10, tax: 0.87, total: 10.87, items: [{ name: "Bud Light", quantity: 2, unit_price: 5, modifiers: [], menu_item_id: M.beer, is_alcohol: true, screening_id: null }] }),
    // Andrew's two beers at cost + 10% and a $12 ticket, by card.
    row({
      id: "o2",
      n: 2,
      method: "card",
      card: 15.68,
      member: "Andrew Clanton",
      subtotal: 14.42,
      tax: 1.26,
      total: 15.68,
      menuValue: 22,
      items: [
        { name: "Bud Light", quantity: 2, unit_price: 1.21, modifiers: [], menu_item_id: M.beer, is_alcohol: true, screening_id: null },
        { name: "Clue", quantity: 1, unit_price: 12, modifiers: [], menu_item_id: null, is_alcohol: false, screening_id: SHOW },
      ],
    }),
  ],
  bookings: [{ quantity: 1, unit_price: 12, tax_amount: 0, order_id: "o2", created_at: at, screening_id: SHOW }],
  booths: [],
  partials: [],
  memberships: [],
  membershipsTracked: true,
  ownerPayments: [],
};
const buckets = new Map([[M.beer, "liquor"]]);
const s = reports.summarizeSales(salesRows, buckets);
check("money in: both orders (the owner paid by card)", Math.abs(s.collected - (10.87 + 15.68)) < 0.001 && s.card === 15.68 && s.cash === 10.87, `collected ${s.collected}`);
check("what sold: the owner's beer is in Alcohol at what they paid; no Owner tab line", Math.abs(s.sold.find((x) => x.label === "Alcohol")?.amount - (10 + 2.42)) < 0.001 && !s.sold.some((x) => x.label === "Owner tab"));
check("the Owner rate summary: 1 order, goods at the owner rate, menu value (the ticket left out), and who", s.ownerRate.orders === 1 && s.ownerRate.sales === 2.42 && s.ownerRate.menuValue === 10 && same(s.ownerRate.who, [{ name: "Andrew", orders: 1 }]), JSON.stringify(s.ownerRate));
const sline = T.ownerRateLine(s.ownerRate);
check("its line reads Owner rate: $2.42 at cost + 10%, $7.58 off menu, Andrew", sline.label === "Owner rate: $2.42 at cost + 10%" && sline.value === "$7.58 off menu" && sline.who === "Andrew");
check("the owner tab summary is empty", s.ownerTab.orders === 0 && s.ownerTab.owed === 0 && s.ownerTab.paid === 0);
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
check("Box office: the owner's ticket was paid at full price, so it counts ($4)", box && box.amount === 4 && !/owner tab/.test(box.rule), JSON.stringify(box));

const digestEmail = await load("lib/email/daily-digest-email.ts");
const dayOrder = (id, n, total, ownerRate) => ({ id, orderNumber: n, status: "completed", items: "", method: "cash", tip: 0, total, refunded: 0, refundable: 0, tax: 0, cash: total, card: 0, voucher: 0, refundedTax: 0, refundedCard: 0, refundedCash: 0, lines: [], ownerTab: null, ownerRate });
const ownerDay = { ...s, membershipLines: [], ownerPaymentLines: [], ticketLines: [], boothLines: [], orders: [dayOrder("o1", 1, 10.87, null), dayOrder("o2", 2, 15.68, "Andrew")], ticketsSold: 1 };
const digestOf = (day) => new Proxy({ label: "Friday, Oct 2", day, lastWeek: null, weekdayAverage: null, next: { items: [] } }, { get: (t, k) => (k in t ? t[k] : []) });
const html = (() => {
  try {
    return digestEmail.dailyDigestHtml(digestOf(ownerDay), "https://example.test/report");
  } catch (e) {
    return `ERROR ${e.message}`;
  }
})();
check("the email counts both orders and shows the Owner rate line with who used it", /2 orders ·/.test(html) && /Owner rate: \$2\.42 at cost \+ 10% \(Andrew\)/.test(html) && /\$7\.58 off menu/.test(html), html.startsWith("ERROR") ? html : "");
const noOwner = digestEmail.dailyDigestHtml(digestOf({ ...ownerDay, ownerRate: { orders: 0, sales: 0, menuValue: 0, who: [] } }), "https://example.test/report");
check("with no owner-rate sales the line isn't there", !/Owner rate: /.test(noOwner));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll owner rate checks passed.");
process.exit(failures ? 1 : 0);
