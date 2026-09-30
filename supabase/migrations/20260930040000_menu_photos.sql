-- Product photos on the register: a photo on each menu button and a small
-- round one on each category tab. Managers take or choose them on the Menu
-- page (Back office), which squares and shrinks them to a small JPEG in the
-- browser and uploads them to the public "menu-photos" Storage bucket
-- (made by scripts/setup-menu-photos-bucket.mjs, like movie-posters).
--
-- The menu is already public-read, so a public photo address is fine.
-- Additive and safe to run twice.
alter table menu_items add column if not exists image_url text;
alter table menu_categories add column if not exists image_url text;
