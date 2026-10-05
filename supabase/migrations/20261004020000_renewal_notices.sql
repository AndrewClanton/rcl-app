-- Insiders+ yearly renewal notices (Andrew, 10/4): a week before a yearly
-- membership renews, the member gets an email with the date, the amount
-- and the card (lib/renewal-notice.ts, run each morning by
-- /api/cron/renewal-notices). One row per renewal noticed, so the same
-- renewal is never noticed twice, however often the job runs: the row is
-- claimed before the email goes (the unique key), and a failed send gives
-- the claim back so the next run tries again.
--
-- No foreign key to members on purpose (like member_paid_through):
-- merge_members refuses to merge an account a foreign key points at.
-- Triggers keep it right instead: a merge moves the rows to the kept
-- account, deleting an account removes them.
--
-- Server-only: RLS on, no client policies. Safe to run more than once.

create table if not exists renewal_notices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  stripe_subscription_id text not null,
  -- When the renewal charges (end of the period, or of the trial for a
  -- paid-through member), and that day in Chicago.
  charge_at timestamptz not null,
  charge_date date not null,
  claimed_at timestamptz not null default now(),
  -- Set once Resend has taken the email.
  sent_at timestamptz,
  resend_id text,
  unique (stripe_subscription_id, charge_date)
);

create index if not exists renewal_notices_member_idx on renewal_notices (member_id, charge_at desc);

alter table renewal_notices enable row level security;
grant select, insert, update, delete on public.renewal_notices to service_role;

create or replace function public.renewal_notices_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update renewal_notices set member_id = new.keep_id where member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists renewal_notices_member_merged on member_merges;
create trigger renewal_notices_member_merged after insert on member_merges
  for each row execute function public.renewal_notices_member_merged();

create or replace function public.members_delete_renewal_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from renewal_notices where member_id = old.id;
  return old;
end;
$$;
drop trigger if exists members_delete_renewal_notices on members;
create trigger members_delete_renewal_notices after delete on members
  for each row execute function public.members_delete_renewal_notices();

-- Trigger functions only; nobody calls these directly.
revoke execute on function public.renewal_notices_member_merged() from public, anon, authenticated;
revoke execute on function public.members_delete_renewal_notices() from public, anon, authenticated;
