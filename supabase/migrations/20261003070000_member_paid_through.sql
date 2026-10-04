-- Insiders+ "paid through" dates (Andrew, 10/3).
--
-- Some former members paid for a whole year of Insiders+ on the old
-- website. members.plus_gift_until already means "Insiders+ is paid for
-- until then" for a gifted year (lib/gift-membership.ts), and everything
-- honors it: the register's gold look, the perks, the daily expiry, and a
-- card added meanwhile holding its first charge until then. So a prepaid
-- year uses the same column, set by an owner or admin on the member's Back
-- office page (lib/paid-through.ts). This table records each change: the
-- date, the plan it renews as, a note, who and when.
--
-- No foreign key to members on purpose (like legacy_billing_payers):
-- merge_members refuses to merge an account a foreign key points at.
-- Triggers keep it right instead: a merge moves the rows to the kept
-- account, deleting an account removes them.
--
-- Server-only: RLS on, no client policies. Safe to run more than once.

comment on column members.plus_gift_until is
  'Insiders+ is paid for until then: a gifted year (gift_memberships) or a year prepaid another way, set by staff (member_paid_through).';

create table if not exists member_paid_through (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  -- The date set (null: taken off), and what it was before.
  paid_through timestamptz,
  previous timestamptz,
  -- The plan their card renews on when the date comes, at that day's price.
  renews_as text not null default 'year' check (renews_as in ('month', 'year')),
  note text,
  set_by uuid references employees(id) on delete set null,
  set_at timestamptz not null default now()
);

create index if not exists member_paid_through_member_idx on member_paid_through (member_id, set_at desc);

alter table member_paid_through enable row level security;
grant select, insert on public.member_paid_through to service_role;

create or replace function public.member_paid_through_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update member_paid_through set member_id = new.keep_id where member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists member_paid_through_member_merged on member_merges;
create trigger member_paid_through_member_merged after insert on member_merges
  for each row execute function public.member_paid_through_member_merged();

create or replace function public.members_delete_paid_through()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from member_paid_through where member_id = old.id;
  return old;
end;
$$;
drop trigger if exists members_delete_paid_through on members;
create trigger members_delete_paid_through after delete on members
  for each row execute function public.members_delete_paid_through();

-- Trigger functions only; nobody calls these directly.
revoke execute on function public.member_paid_through_member_merged() from public, anon, authenticated;
revoke execute on function public.members_delete_paid_through() from public, anon, authenticated;
