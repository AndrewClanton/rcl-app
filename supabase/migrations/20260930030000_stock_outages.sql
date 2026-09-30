-- "Ran out" (86 it): staff report mid-shift that something ran out, the
-- register stops offering the menu items that need it, and it goes to the
-- top of the shopping list until someone buys it.
--
-- stock_outages: one row per "we're out of X". par_item_id links it to the
-- par sheet when it's on there; label is what ran out, as reported (the par
-- line's name at the time, or whatever was typed for something that isn't on
-- the sheet). Open until resolved: bought, found (there was more in the
-- back), or mistake (reported by accident).
--
-- menu_items.out_since: set while an item is 86'd. out_note is the reason the
-- register shows on the button ("Out of hot dog buns"); the menu is public,
-- so staff's own note stays on stock_outages. out_outage_id is the outage
-- that stopped it, so "Bought it" puts it back on sale.
--
-- Staff-only data: RLS on, no policies; read and written by the server.
-- Additive and safe to run twice.

create table if not exists stock_outages (
  id uuid primary key default gen_random_uuid(),
  par_item_id uuid references par_items(id) on delete set null,
  label text not null check (char_length(label) between 1 and 80),
  note text check (note is null or char_length(note) <= 300),
  -- The menu items this report stopped selling (for the history and the
  -- daily email; menu_items.out_outage_id is what's live).
  stopped_item_ids uuid[] not null default '{}',
  reported_by uuid references employees(id) on delete set null,
  shift_id uuid references shifts(id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references employees(id) on delete set null,
  resolution text check (resolution in ('bought', 'found', 'mistake')),
  constraint stock_outages_resolved_together check ((resolved_at is null) = (resolution is null))
);

create index if not exists stock_outages_open_idx on stock_outages(reported_at) where resolved_at is null;
create index if not exists stock_outages_reported_at_idx on stock_outages(reported_at desc);
-- A par line is out once at a time; reporting it again adds to the open one.
create unique index if not exists stock_outages_one_open_per_par_item on stock_outages(par_item_id) where resolved_at is null and par_item_id is not null;

alter table stock_outages enable row level security;

alter table menu_items add column if not exists out_since timestamptz;
alter table menu_items add column if not exists out_note text;
alter table menu_items add column if not exists out_outage_id uuid references stock_outages(id) on delete set null;
create index if not exists menu_items_out_since_idx on menu_items(out_since) where out_since is not null;

-- The shift tools' change log also records outages ("Ran out of Hot dog
-- buns") and items going back on sale. Widens the two checks; every
-- existing value is still allowed.
alter table ops_changes drop constraint if exists ops_changes_entity_check;
alter table ops_changes add constraint ops_changes_entity_check check (entity in ('task', 'par_item', 'reminder', 'outage', 'menu_item'));
alter table ops_changes drop constraint if exists ops_changes_action_check;
alter table ops_changes add constraint ops_changes_action_check check (action in ('added', 'changed', 'removed', 'restored', 'reported', 'resolved'));
