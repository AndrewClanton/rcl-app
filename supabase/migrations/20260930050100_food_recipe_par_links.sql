-- Recipes for the food that runs out, linked to the par sheet, so "Ran out"
-- pre-ticks the right menu buttons: out of hot dog buns stops Hot dog
-- (regular), out of pizza crust stops both pizzas, out of popcorn kernels
-- stops every popcorn.
--
--   Hot dog (regular)   1 Hot dog bun (count) + 1 Hot dog (count)
--   Pizza (slice)       1 Pizza crust (count)       nominal amount
--   Pizza (large)       1 Pizza crust (count)       nominal amount
--   Popcorn (small, personal, large)
--                       1 oz Popcorn kernels        nominal amount
--
-- Only the hot dog amounts are real. The others are a placeholder 1 until
-- someone sets the real amount on Menu → Recipe; the link to the par line is
-- what matters here.
--
-- Idempotent: an ingredient already linked to the par line is used as is;
-- one with the same name is linked if it isn't linked yet; otherwise it's
-- created, linked. A same-named ingredient linked to a different par line
-- is left alone and that line skipped (a person should look). A menu item's
-- existing recipe is kept (only the missing line is added), and an
-- ingredient already in a recipe keeps its amount. Menu items or par lines
-- that aren't there (renamed, switched off) are skipped. Every change is
-- raised as a notice.

do $$
declare
  link record;
  v_item uuid;
  v_par uuid;
  v_ing uuid;
  v_linked uuid;
  v_recipe uuid;
begin
  for link in
    select * from (values
      ('Hot dog (regular)', 'Hot dog bun', 'Hot dog buns', 'count', 'Hot dogs', 1.0, 0),
      ('Hot dog (regular)', 'Hot dog', 'Hot dogs', 'count', 'Hot dogs', 1.0, 1),
      ('Pizza (slice)', 'Pizza crust', 'Pizza crust', 'count', 'Pizza', 1.0, 0),
      ('Pizza (large)', 'Pizza crust', 'Pizza crust', 'count', 'Pizza', 1.0, 0),
      ('Popcorn (small)', 'Popcorn kernels', 'Popcorn kernels', 'oz', 'Popcorn', 1.0, 0),
      ('Popcorn (personal)', 'Popcorn kernels', 'Popcorn kernels', 'oz', 'Popcorn', 1.0, 0),
      ('Popcorn (large)', 'Popcorn kernels', 'Popcorn kernels', 'oz', 'Popcorn', 1.0, 0)
    ) as l(item, ingredient, par, unit, category, qty, sort)
  loop
    select id into v_item from menu_items where name = link.item and active order by sort_order limit 1;
    select id into v_par from par_items where name = link.par and active order by sort_order limit 1;
    if v_item is null or v_par is null then
      raise notice 'skipped %: % (menu item found: %, par line found: %)', link.item, link.ingredient, v_item is not null, v_par is not null;
      continue;
    end if;

    select id into v_ing from ingredients where par_item_id = v_par order by active desc, created_at limit 1;
    if v_ing is null then
      select id, par_item_id into v_ing, v_linked from ingredients where lower(name) = lower(link.ingredient);
      if v_ing is null then
        insert into ingredients (name, unit, category, par_item_id) values (link.ingredient, link.unit, link.category, v_par) returning id into v_ing;
        raise notice 'ingredient created: % (%), linked to par line %', link.ingredient, link.unit, link.par;
      elsif v_linked is null then
        update ingredients set par_item_id = v_par where id = v_ing and par_item_id is null;
        raise notice 'ingredient % linked to par line %', link.ingredient, link.par;
      else
        raise notice 'skipped %: ingredient % is linked to a different par line', link.item, link.ingredient;
        continue;
      end if;
    end if;

    insert into recipes (menu_item_id) values (v_item) on conflict (menu_item_id) do nothing;
    if found then
      raise notice 'recipe created: %', link.item;
    end if;
    select id into v_recipe from recipes where menu_item_id = v_item;
    insert into recipe_ingredients (recipe_id, ingredient_id, quantity, sort_order)
    values (v_recipe, v_ing, link.qty, link.sort)
    on conflict (recipe_id, ingredient_id) do nothing;
    if found then
      raise notice 'recipe line: % uses % %', link.item, link.qty, link.ingredient;
    end if;
  end loop;
end $$;
