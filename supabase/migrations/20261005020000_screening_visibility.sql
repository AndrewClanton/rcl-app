-- Who a showing is listed for (src/lib/showing-visibility.ts):
--   public  -- the website, lobby TVs and emails, as always (the default)
--   members -- only signed-in members on the website, plus the members' email
--   private -- never listed or sold online; Back office and the register only
-- Every existing showing stays public. No new objects, so no new grants:
-- screenings keeps its existing policies (staff and display screens read it;
-- the public site reads it on the server).
alter table public.screenings
  add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'members', 'private'));

comment on column public.screenings.visibility is
  'public | members (signed-in members only) | private (never listed or sold online)';

-- house_events (trivia, comedy, the book swap) are public happenings by
-- definition; a private group goes in the events table, so they get no
-- visibility of their own.
