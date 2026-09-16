-- Alcohol recipe standardization + ingredient inventory tracking, so every
-- bartender builds a drink the same way and staff can compare theoretical
-- ingredient usage (recipe quantities x drinks sold) against physical bottle
-- counts to spot overpour/waste.

-- ---------- ingredients (shared catalog, referenced by recipes and by physical counts) ----------
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Every quantity for this ingredient (recipe amounts, physical counts) is
  -- expressed in this single unit, so usage math never needs conversion.
  unit text not null default 'oz' check (unit in ('oz', 'ml', 'count')),
  -- Size of one standard container in `unit` (e.g. 25.4 for a 750ml bottle
  -- measured in oz) -- optional, just a reference for staff doing counts.
  bottle_size numeric(10,2),
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index ingredients_name_idx on ingredients(lower(name));

-- ---------- recipes (one per menu item that has one -- typically alcohol) ----------
create table recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null unique references menu_items(id) on delete cascade,
  instructions text,
  glassware text,
  garnish text,
  created_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  -- restrict, not cascade: force deactivating (not deleting) an ingredient
  -- that's still used in a recipe, so historical usage math stays sound.
  ingredient_id uuid not null references ingredients(id) on delete restrict,
  quantity numeric(10,3) not null check (quantity > 0),
  sort_order int not null default 0
);

create index recipe_ingredients_recipe_id_idx on recipe_ingredients(recipe_id);
create unique index recipe_ingredients_unique_idx on recipe_ingredients(recipe_id, ingredient_id);

-- ---------- inventory_counts (physical stock snapshots, logged periodically by staff) ----------
create table inventory_counts (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  quantity_on_hand numeric(10,2) not null check (quantity_on_hand >= 0),
  counted_by uuid references employees(id),
  note text,
  counted_at timestamptz not null default now()
);

create index inventory_counts_ingredient_id_idx on inventory_counts(ingredient_id, counted_at);

-- ---------- Row Level Security ----------
-- Same posture as `members`: no read policy at all. Recipes and inventory
-- are staff-only information (not shown on the public menu), always read
-- via the service-role client from admin/POS server code.
alter table ingredients enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table inventory_counts enable row level security;
