-- Spend points in sections (Andrew, 10/9): the customer screen's list and
-- Back office -> Points group the catalog as Money off, Food & drinks,
-- Tickets & booths, then Make it yours (the perks, by slot). A discount
-- and a perk know their section from their kind; a good says which one it
-- is here, editable in Back office -> Points. Null: the app guesses from
-- the name (a ticket, booth or pass is Tickets & booths, anything else
-- Food & drinks; lib/rewards.ts sectionOf).
--
-- Additive: one nullable column on an existing table, which keeps its
-- grants (service_role: select, insert, update, delete, migration
-- 20261007020000), so nothing new to grant. Safe to run more than once.

alter table public.reward_catalog add column if not exists section text;

alter table public.reward_catalog drop constraint if exists reward_catalog_section_check;
alter table public.reward_catalog add constraint reward_catalog_section_check
  check (section is null or (kind = 'good' and section in ('food', 'tickets')));

-- The goods already in the catalog.
update public.reward_catalog
set section = case when name ~* '(ticket|booth|pass|seat|rental)' then 'tickets' else 'food' end
where kind = 'good' and section is null;
