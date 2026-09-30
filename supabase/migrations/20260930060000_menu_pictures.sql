-- Menu pictures: where each register button's picture came from.
--
-- Every item and category shows a picture: a photo someone took or chose
-- ('upload'), a free-to-use photo the server found and stored in our own
-- menu-photos bucket ('off' = Open Food Facts, 'openverse', 'commons' =
-- Wikimedia Commons), or the label tile ('label': the name on its
-- category's color, no file). Found photos keep their credit (creator,
-- license, source page) for attribution, the search that found them and
-- their place in its results, so the register's ◀ ▶ can carry on from
-- there. image_approved_at is set when a manager keeps a found photo on the
-- Photo walk.
--
-- Additive only: existing rows keep their image_url, and a row with a photo
-- but no source reads as an upload.

alter table menu_items add column if not exists image_source text;
alter table menu_items add column if not exists image_credit jsonb;
alter table menu_items add column if not exists image_query text;
alter table menu_items add column if not exists image_index int;
alter table menu_items add column if not exists image_approved_at timestamptz;

alter table menu_categories add column if not exists image_source text;
alter table menu_categories add column if not exists image_credit jsonb;
alter table menu_categories add column if not exists image_query text;
alter table menu_categories add column if not exists image_index int;
alter table menu_categories add column if not exists image_approved_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_image_source_check') then
    alter table menu_items add constraint menu_items_image_source_check
      check (image_source is null or image_source in ('upload', 'label', 'off', 'openverse', 'commons'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_categories_image_source_check') then
    alter table menu_categories add constraint menu_categories_image_source_check
      check (image_source is null or image_source in ('upload', 'label', 'off', 'openverse', 'commons'));
  end if;
end $$;
