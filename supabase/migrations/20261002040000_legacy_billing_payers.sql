-- Former unlimited members the old system actually charged (Andrew, 10/2).
--
-- About 300 members paid for unlimited on the old website
-- (members.legacy_plus), but its card processor (Fortis) billed almost
-- none of them: of its 9 recurring schedules ever, 3 were charged in
-- September 2026. Those 3 are paying on the old system, so "Press play"
-- (Back office -> Email -> Ready to send, Email 3: "your unlimited is on
-- pause, nothing's owed") isn't true for them. They're listed here and
-- left out of it (src/lib/email/audience.ts), counted on that screen as
-- "Paid on the old system in September".
--
-- Member ids only (no names or card details). Seeded by
-- scripts/seed-legacy-billing-payers.mjs from the private match file in
-- the imports folder.
--
-- Like member_cards (20261001220000), no foreign key to members on
-- purpose: merge_members refuses to merge an account any foreign key
-- still points at. Triggers keep it right instead: a merge moves the row
-- to the kept account, deleting an account removes it.
--
-- Server-only: RLS on, no client policies. Safe to run more than once.

create table if not exists legacy_billing_payers (
  member_id uuid primary key,
  -- The last approved charge on the old system.
  last_paid_on date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table legacy_billing_payers enable row level security;

create or replace function public.legacy_billing_payers_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into legacy_billing_payers (member_id, last_paid_on, note, created_at)
    select new.keep_id, last_paid_on, note, created_at from legacy_billing_payers where member_id = new.dropped_id
    on conflict (member_id) do update set last_paid_on = greatest(legacy_billing_payers.last_paid_on, excluded.last_paid_on);
  delete from legacy_billing_payers where member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists legacy_billing_payers_member_merged on member_merges;
create trigger legacy_billing_payers_member_merged after insert on member_merges
  for each row execute function public.legacy_billing_payers_member_merged();

create or replace function public.members_delete_legacy_billing_payer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from legacy_billing_payers where member_id = old.id;
  return old;
end;
$$;
drop trigger if exists members_delete_legacy_billing_payer on members;
create trigger members_delete_legacy_billing_payer after delete on members
  for each row execute function public.members_delete_legacy_billing_payer();

-- Trigger functions only; nobody calls these directly.
revoke execute on function public.legacy_billing_payers_member_merged() from public, anon, authenticated;
revoke execute on function public.members_delete_legacy_billing_payer() from public, anon, authenticated;
