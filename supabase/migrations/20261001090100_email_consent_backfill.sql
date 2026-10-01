-- A prefs row (src/lib/email/consent.ts) and a recorded consent source for
-- every existing member, so the Back office can say where each person's
-- "yes" came from and warm-up can start with the people most likely to
-- want the email.
--
-- Nobody's email is switched on or off here: members.email_opt_in is not
-- touched. Every category starts on, the way a missing row reads anyway.
--
-- Where consent came from:
--   old_site_import  copied over from the old website (legacy_user_id)
--   kiosk            chose at the register's check-in screen (no website
--                    login, and a recorded choice)
--   account          chose on their account page (a website login, and a
--                    recorded choice)
--   unknown          everyone else (the old "on by default")
--
-- Old-site imports also keep how the loader sorted them (paying,
-- likely_real, review), copied from legacy_accounts once, here, so the
-- warm-up order never has to read that table.
--
-- Additive and safe to run twice: rows that already exist are left alone.

insert into member_email_prefs (member_id, consent_source, consent_at)
select m.id,
  case
    when m.legacy_user_id is not null then 'old_site_import'
    when m.email_opt_in_changed_at is not null and m.auth_user_id is null then 'kiosk'
    when m.email_opt_in_changed_at is not null then 'account'
    else 'unknown'
  end,
  coalesce(m.email_opt_in_changed_at, m.imported_at, m.created_at)
from members m
where m.erased_at is null
on conflict (member_id) do nothing;

do $$
begin
  if to_regclass('public.legacy_accounts') is not null then
    update member_email_prefs p
    set import_group = la.classification
    from members m
    join legacy_accounts la on la.legacy_user_id = m.legacy_user_id
    where p.member_id = m.id
      and p.import_group is null
      and la.classification in ('paying', 'likely_real', 'review');
  end if;
end $$;

-- The evidence trail starts with where each person stood on the day this
-- went in (one row each, never repeated).
insert into email_consent_log (member_id, action, source, detail, at)
select p.member_id, 'import', 'backfill',
  jsonb_build_object('consent_source', p.consent_source, 'email_opt_in', coalesce(m.email_opt_in, true)),
  now()
from member_email_prefs p
join members m on m.id = p.member_id
where not exists (
  select 1 from email_consent_log l where l.member_id = p.member_id and l.action = 'import' and l.source = 'backfill'
);
