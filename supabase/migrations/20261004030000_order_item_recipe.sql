-- A Bar Book drink rung up off the menu (the register's Bar Book → "Add to
-- order") is a one-off line like "+ Custom item": no menu item, staff's
-- price. order_items.recipe_id says which recipe it was, so:
--   - the bar tablet shows its drink icon and Recipe card
--   - Reports → Bar usage counts its pours from that recipe, as it does for
--     menu drinks
--   - the daily email doesn't list it as an unexplained custom item
-- The server sets it only on a one-off line naming a real recipe with no
-- menu item (src/app/pos/actions.ts); anything else is dropped.
--
-- If the recipe is later deleted the sale stays, without the link.
--
-- Columns only (no new table or function, so no grants). Safe to run twice.
-- Before it's applied, the register saves these lines without the link
-- (exactly like a custom item) and everything else reads as before.

alter table order_items add column if not exists recipe_id uuid references recipes(id) on delete set null;

create index if not exists order_items_recipe_id_idx on order_items(recipe_id) where recipe_id is not null;
