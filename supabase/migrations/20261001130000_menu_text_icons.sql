-- Menu text icons, and two more picture libraries.
--
-- A register button can show a text icon instead of a photo: a few big
-- characters ("$5" glowing red for the $5 special) drawn by the app, with no
-- file. Stored as image_source 'text' with image_text
-- { "text": "$5", "color": "red", "style": "neon", "pulse": true }: the
-- color and style are names from the app's own lists
-- (src/lib/menu-pictures/text-icon.ts), never raw CSS, and the app checks
-- every one it saves or shows. image_url stays null for a text icon.
--
-- Found photos can now also come from Pixabay ('pixabay') and Pexels
-- ('pexels'), downloaded to our own menu-photos bucket like the others.
--
-- Additive and safe to run twice: a new nullable column, and the
-- image_source checks widened (every value they allowed before is still
-- allowed). Run this before setting PIXABAY_API_KEY or PEXELS_API_KEY.
-- Until it runs:
--   - saving a text icon says the database needs this update;
--   - the picture finder leaves Pixabay and Pexels out even when their keys
--     are set (it looks for the image_text column added here), because the
--     old checks turn their pictures down. If a save is turned down anyway,
--     the picker says why and finding pictures on its own moves on to
--     another library's.
-- Photos, label tiles and the other libraries work the same either way.

alter table menu_items add column if not exists image_text jsonb;
alter table menu_categories add column if not exists image_text jsonb;

alter table menu_items drop constraint if exists menu_items_image_source_check;
alter table menu_items add constraint menu_items_image_source_check
  check (image_source is null or image_source in ('upload', 'label', 'text', 'off', 'openverse', 'commons', 'pixabay', 'pexels'));

alter table menu_categories drop constraint if exists menu_categories_image_source_check;
alter table menu_categories add constraint menu_categories_image_source_check
  check (image_source is null or image_source in ('upload', 'label', 'text', 'off', 'openverse', 'commons', 'pixabay', 'pexels'));

-- A text icon is an object with 1 to 16 characters of text (counted the way
-- the app counts them). coalesce: a check that comes out null would pass.
alter table menu_items drop constraint if exists menu_items_image_text_check;
alter table menu_items add constraint menu_items_image_text_check
  check (
    image_text is null
    or coalesce(
      jsonb_typeof(image_text) = 'object'
      and jsonb_typeof(image_text -> 'text') = 'string'
      and char_length(image_text ->> 'text') between 1 and 16,
      false
    )
  );

alter table menu_categories drop constraint if exists menu_categories_image_text_check;
alter table menu_categories add constraint menu_categories_image_text_check
  check (
    image_text is null
    or coalesce(
      jsonb_typeof(image_text) = 'object'
      and jsonb_typeof(image_text -> 'text') = 'string'
      and char_length(image_text ->> 'text') between 1 and 16,
      false
    )
  );
