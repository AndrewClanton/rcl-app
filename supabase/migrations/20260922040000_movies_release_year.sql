-- MPLC's umbrella license covers public performance of the current year's
-- releases, but anything older can only be shown to people who already
-- know about it (informed privately, e.g. by email) -- not advertised on
-- any public-facing page. release_year drives that filter (see
-- excludeRestrictedReleases in src/lib/data/screenings.ts). Null (unknown
-- release year) is treated as restricted too, by design -- fail closed.
alter table movies add column release_year integer;
