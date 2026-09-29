-- Link a recipe ingredient to the par sheet line it's bought from.
--
-- Recipes (ingredients) and the par sheet (par_items, the register's shift
-- tools) were two separate lists. When a manager adds something to a recipe
-- that we don't stock yet (Torani vanilla syrup, popping oil, paper bags),
-- the recipe editor can now put it on the par sheet in the same step, and
-- this column remembers which par line it is. Nothing requires it: most
-- par lines (cleaning spray, candy) are never in a recipe, and an ingredient
-- can stay unlinked.
--
-- Additive and safe to re-run.

alter table ingredients add column if not exists par_item_id uuid references par_items(id) on delete set null;

create index if not exists ingredients_par_item_id_idx on ingredients(par_item_id);

-- Backfill the ones that already match by name, ignoring case, spaces and
-- punctuation ("Triple Sec" = "Triple sec", "Sweet Vermouth" = "sweet-vermouth").
-- Only when exactly one active par line has that name (Coke is on the sheet
-- twice, fountain and canned, so it's left for a person to pick), only for
-- ingredients that aren't linked yet, and only to par lines no ingredient
-- already has. Running it again changes nothing.
with par_keys as (
  select id, regexp_replace(lower(name), '[^a-z0-9]', '', 'g') as key
  from par_items
  where active
),
unique_par as (
  select key, (array_agg(id))[1] as par_item_id
  from par_keys
  where key <> ''
  group by key
  having count(*) = 1
),
candidates as (
  select i.id as ingredient_id, p.par_item_id
  from ingredients i
  join unique_par p on p.key = regexp_replace(lower(i.name), '[^a-z0-9]', '', 'g')
  where i.par_item_id is null
    and not exists (select 1 from ingredients o where o.par_item_id = p.par_item_id)
),
one_each as (
  select par_item_id from candidates group by par_item_id having count(*) = 1
)
update ingredients i
set par_item_id = c.par_item_id
from candidates c
join one_each o on o.par_item_id = c.par_item_id
where i.id = c.ingredient_id;
