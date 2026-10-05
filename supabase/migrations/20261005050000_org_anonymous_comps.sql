-- Organization guests with no account (Andrew, 10/5): some supported
-- guests can't give a name, phone or email, and helpers turn over often. A
-- helper says "we're with Easter Seals" and the cashier logs the group by
-- count from the register ("Organization guests"): 2 supported guests + 2
-- helpers. Each person is still one comp against the daily limit, and the
-- statement lists them as "no account".
--
--   org_comps.member_id   now null for a guest with no account.
--   org_comps.anonymous   true for those rows.
--   org_comps.role        'supported' or 'helper' on an anonymous day pass
--                         (null on movies and named comps: the member's
--                         own role says it).
--   org_comps.group_id    one id per group (all its rows), so the group can
--                         come back to the counter later that day and get
--                         its movies and pricing without new comps.
--   org_comps.note        the cashier's short note ("red shirt").
--
-- No new tables, so no new grants (org_comps has service_role already).
-- Additive and safe to run more than once.

alter table org_comps alter column member_id drop not null;
alter table org_comps add column if not exists anonymous boolean not null default false;
alter table org_comps add column if not exists role text;
alter table org_comps add column if not exists group_id uuid;
alter table org_comps add column if not exists note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_comps_role_check') then
    alter table org_comps add constraint org_comps_role_check check (role is null or role in ('helper', 'supported'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_comps_note_check') then
    alter table org_comps add constraint org_comps_note_check check (note is null or length(note) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_comps_who_check') then
    alter table org_comps add constraint org_comps_who_check check (member_id is not null or (anonymous and group_id is not null));
  end if;
end $$;

create index if not exists org_comps_group_idx on org_comps (group_id) where group_id is not null;
