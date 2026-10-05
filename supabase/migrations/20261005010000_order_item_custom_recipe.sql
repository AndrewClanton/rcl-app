-- "What's in it?" on the register's Bar tab: staff tap in what a guest
-- described, and when it isn't a drink in the Bar Book it goes on the order
-- as a custom drink, a one-off line like "+ Custom item" that carries its
-- ingredient list:
--
--   order_items.custom_recipe  [{ "ingredient_id": uuid, "quantity": 1.5,
--                                 "name": "Well Vodka", "unit": "oz",
--                                 "family": "vodka", "kind": "spirit" }, ...]
--
-- The server keeps it only on a one-off line (no menu item, no Bar Book
-- recipe, not a ticket), at most 12 lines, each a real ingredient with
-- 0 < quantity <= 10, and fills in the names, units and colors itself
-- (src/lib/bar/match.ts cleanCustomRecipe). Anything else is dropped and the
-- line saves as a plain custom line. It's a copy taken at the sale, so the
-- list still reads right if an ingredient is renamed or removed later.
--
-- Read by Reports -> Bar usage (its pours), the daily email and Register
-- checks (the list), and the bar tablet (its icon and Recipe card).
--
-- Columns only (no new table or function, so no grants). Safe to run twice.
-- Before it's applied, these lines save as plain custom lines and every
-- reader reads as before.

alter table order_items add column if not exists custom_recipe jsonb;

alter table order_items drop constraint if exists order_items_custom_recipe_check;
alter table order_items add constraint order_items_custom_recipe_check
  check (custom_recipe is null or (jsonb_typeof(custom_recipe) = 'array' and jsonb_array_length(custom_recipe) between 1 and 12));
