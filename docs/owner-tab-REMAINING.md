# Owner rate: what's left

v1.42.0 (Andrew, 10/5) replaced the v1.39.0 owner tab. The owner rate is now **cost + 10%**, paid at the register like any order. There's no monthly tab.

## How it works now

- **Who.** An active employee with role owner and the owner rate switched on (Back office → Owner rate, `employees.owner_rate`). Their member account is the one that shares their login (`auth_user_id`, the same link Staff logins uses): `ownerMembers` / `ownerForMember` in `src/lib/owner-rate-server.ts`.
- **Register.** When that owner's own account is attached to the order, an **Owner rate (cost + 10%)** checkbox shows with Monthly member / Tax exempt. Ticking it:
  - asks the server for prices (`quoteOwnerRate`, `src/app/pos/owner-rate-actions.ts`) and asks again whenever the order changes;
  - crosses out the menu prices;
  - turns off and hides member discounts, the daily coffee, rewards, Tax exempt and org comps.
  - Pay is disabled until the prices are back. Then it's paid by card, cash or a split.
  - The always-visible Owner rate button, the PIN box (`OwnerRateModal`) and "Put on owner tab" are gone.
- **No PIN.** The checkbox only shows for the owner's own account. The server checks the account again on `checkBeforePayment` and `completeOrder`, so a cashier can't use it for anyone else. The order records:
  - `employee_id`: who rang it up and ticked it;
  - `member_id`: whose account it was;
  - `owner_menu_value`: the menu value, which marks it as an owner-rate sale;
  - on each line, `menu_unit_price` and `owner_pricing`.
  - It earns no points.
- **Pricing.** `src/lib/register-totals.ts` has `OWNER_RATE_MARKUP = 0.1` (the one setting) and `ownerCostPrice`.
  - A menu item is its recipe cost + 10%, but only when "Recipe cost is complete" is ticked and every ingredient has a cost. It's never more than the menu price.
  - If there's no cost, the fallback is half the menu price, as before.
  - Options are charged at half. Tickets and custom items are at their normal price.
  - Off-menu Bar Book and custom drinks are cost + 10% when fully costed, otherwise half. A Double on one is half.
- **Reports.** Owner-rate sales count as ordinary paid sales: they're in Collected and in their categories at owner prices. Day, Period and the nightly email show a line "Owner rate: $X at cost + 10%" / "$Y off menu" with who used it (`ownerRateLine`, `OwnerRateSummary` in `src/lib/data/reports.ts`). The Orders list marks each one "· owner rate (Name)", and the Orders filter "Owner rate" finds them.
- **Box office.** Tickets on an owner-rate order are paid at full price, so the $4 box office carve-out counts them like any paid ticket. The "leave owner-tab tickets out" rule only applied to the old no-money tab, so it no longer matters.
- **Back office → Owner rate** (`/admin/owner-rate`, was `/admin/owner-tab`) has:
  - who gets it (owners only, with a flag when they have no member account);
  - changes to that;
  - the latest owner-rate orders (owner, who rang it up, menu value, paid);
  - Prices;
  - how it's priced.
  - The month cards, statements, record-payment form and Today's "Owner tab this month" card are removed.

## Kept on purpose

- **Database.** Every column and table from `20261003060000_owner_tab.sql` stays: `owner_tab_payments`, `record_owner_tab_payment()`, `orders.owner_tab_employee_id` / `owner_rate_nonce` / `owner_tab_removed_*`, and the `owner_tab` payment method in the check constraint. Nothing new was added; no migration.
- **Legacy reads.** Reports, Recent orders, the refund path ("Take off tab") and the nightly email still handle `payment_method = 'owner_tab'`. None were ever made (checked read-only on 10/5: 0 owner-tab orders, 0 payments), and the register can't make one now, so that code never runs. It can be deleted later along with the columns.

## Checks

These pass:

- `scripts/check-owner-tab.mjs`, rewritten for the owner rate: the math, who gets it, quote, `checkBeforePayment`, `completeOrder` saving and refusing, and reports and email.
- `check-org-totals`, `check-receipt`, `check-order-ticket`, `check-card-points`, `check-daily-coffee`, `check-bar-book`.
- `tsc --noEmit`, eslint and `next build`.

## Left to do or confirm

- Try it on a real register: attach Andrew's account, tick Owner rate, change the order, and pay by card on the reader and by split.
- On 10/5 all four owners (Andrew, Caleb, Nathan, Mary) already had the owner rate on, and each has a member account. Untick anyone who shouldn't get it.
- A Double on an off-menu Bar Book drink is still half its rung price, not cost + 10%: the extra pour isn't in the recipe. Confirm this with Andrew.
- The owner rate doesn't go with Tax exempt. Owner orders are taxed as usual.
