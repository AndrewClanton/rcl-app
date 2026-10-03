-- Former unlimited members: people who paid for unlimited (Insiders+) on
-- the old website (members.legacy_plus) whose old billing never actually
-- charged them, so nothing is paying for it here. The register flags them
-- ("No payment on file for unlimited membership") and sets them up in
-- person: their card on the reader, or Stripe's page on their own phone
-- (src/lib/legacy-plus.ts). This records when that happened, so Back
-- office -> Members -> Former unlimited members can show who's done.
--
--   legacy_onboarded_at    when their Insiders+ was set up after the move
--   legacy_onboarded_via   'reader' (card tapped at the register), 'phone'
--                          (the link staff showed or emailed them), or
--                          'online' (they joined on the website themselves)
--   legacy_onboarded_by    who set it up at the register (null for phone and
--                          online)
--
-- Until this runs the app still works: the register shows the flag to
-- anyone with legacy_plus and nothing paying, and the list counts a live
-- Insiders+ subscription as set up (without the date). Additive, and safe
-- to run more than once.

alter table members add column if not exists legacy_onboarded_at timestamptz;
alter table members add column if not exists legacy_onboarded_via text;
alter table members add column if not exists legacy_onboarded_by uuid references employees(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_legacy_onboarded_via_check') then
    alter table members add constraint members_legacy_onboarded_via_check
      check (legacy_onboarded_via is null or legacy_onboarded_via in ('reader', 'phone', 'online'));
  end if;
end $$;

-- The list reads only these few hundred rows.
create index if not exists members_legacy_plus_idx on members (id) where legacy_plus;
