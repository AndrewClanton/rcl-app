-- Each booth now gets its own real photo (replacing the interactive floor
-- plan) -- customers pick a booth by recognizing it in a photo, since the
-- 8 booths are all visually distinct.
alter table booths add column photo_url text;
