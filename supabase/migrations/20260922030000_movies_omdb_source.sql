-- Movie data now comes from OMDb (real IMDb-sourced ratings/plot/runtime),
-- imported once into this table instead of TMDb, and posters are downloaded
-- into our own storage instead of being hotlinked from a third party on
-- every page view (see scripts/backfill-movie-posters.mjs for existing rows).
alter table movies add column imdb_id text unique;
alter table movies rename column poster_path to poster_url;
