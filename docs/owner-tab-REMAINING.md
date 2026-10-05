# Owner rate and monthly owner tab: what's left

Branch: `claude/owner-tab` (main v1.36.0 merged in; package.json is 1.37.0).
Nothing here has been run against a database or in a browser.

## Done

- Review items 1-5 (approval tied to the order, retry safety, `recipes.cost_complete`, another owner's PIN to take an order off a tab, stale-price refusal).
- Merge of main v1.36.0 (Bar Book, Double/Neat/Rocks, recipe_id/custom_recipe lines, Prices, org comps, tax-included pricing, member notes, showtimes), main's behavior unchanged.
  - The owner rate excludes org comps and tax-included pricing: while it's on, `compPlan` and tax-included pricing are off and the organization banner is hidden (`PosApp.tsx`); approving it clears the comp override.
  - `completeOwnerTabOrder` refuses an order carrying a member, perks, org comps or tax-included pricing (`ownerOrderExtras` in `src/lib/register-totals.ts`).
  - Off-menu Bar Book and custom drinks are priced at cost when every required ingredient is costed (`drinkCost`), else half the rung price (`ownerOffMenuPrice`, used by `priceOwnerSale` in `src/lib/owner-rate-server.ts`). A Double on one is half.
  - Double/Neat/Rocks on a menu line: priced like any sale (`menuLinePrice` in `src/lib/register-sale-checks.ts`), and the owner pays half of the add-on.
- Item 6: reports redaction where the data is read (`getDayReport`, `getOrderByNumber` in `src/lib/data/reports.ts`: redacted unless the caller passes an owner; `getOwnerTabOverview`, `getOwnerStatement`, `ownerTabThisMonth` in `src/lib/data/owner-tab.ts` refuse non-owners).
- Item 7: nightly email leaves owner-tab orders out of count, money and average; one "Owner tab: N orders, $X at cost" line.
- Item 8: Box office `$4 x tickets` leaves owner-tab tickets out (`src/lib/data/reports.ts`).
- Wording nits (Of it, sales tax; owed on owner tabs; taken off owner tab).
- `scripts/check-owner-tab.mjs` updated and extended.

## Checks (all pass)

`check-owner-tab`, `check-receipt`, `check-order-ticket`, `check-card-points`, `check-daily-coffee`, `check-bar-book`, `check-grants` on the owner tab migration, `tsc --noEmit`, eslint (0 errors), and `next build --experimental-build-mode=compile --webpack`.

## Migration to apply

`supabase/migrations/20261003060000_owner_tab.sql` (apply with `scripts/apply-sql.mjs`). Its timestamp is after the grant cutoff (20261003000000), so grants are required and `check-grants` passes (tables, function grants present). It is older than main's 20261004-20261005 migrations but independent of them; apply order doesn't matter. Until it's applied the register keeps working and the owner rate shows as "not set up".

## Left to do or confirm

- Try it on a real register (iPad layout, `OrderLineRow` owner price, the org banner hidden under the owner rate, a held tab and a draft with the owner rate): the merge was verified by types, lint and the DB-free checks only.
- `src/lib/data/box-office.ts` (the Box office page, separate from the Day report's Box office rule) still counts register tickets on owner-tab orders. Decide whether they should be left out there too.
- A Double on an off-menu Bar Book drink is charged half its rung price, not its recipe cost (the double's extra pour isn't in the recipe). Confirm this with Andrew.
- The Double/Neat/Rocks server path (`menuLinePrice` through `priceOwnerSale`) is covered by the half-add-on math and a source check, not by a run against faked categories and recipes.
- Sales tax on owner tabs: counted in the month rung; confirm with the accountant.
