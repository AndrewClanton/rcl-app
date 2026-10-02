-- "Flag suspicious activity" (Andrew, 10/2): the register has no reversal
-- buttons any more. Staff who think a check-in wasn't right (someone used
-- another person's number, or checked in without being here) flag the
-- account from the press-and-hold panel instead, and an admin or owner
-- looks at it in Back office: the member's page shows each flag, can take
-- back the flagged check-in's points, and clears the flag. A flag never
-- blocks anything at the register.
--
--   member_flags  one row per flag: who flagged it (the cashier on the
--                 register), when, the reason, an optional note, and the
--                 check-in it was about (that business day's visit, if
--                 they had one). Clearing it, and taking back the check-
--                 in's points, each record who and when.
--
-- No foreign key to members, on purpose (like the roadmap tables,
-- 20261001210000): merge_members() (20261001150000) refuses to merge an
-- account that any foreign key still points at. Triggers below keep the
-- rows right instead: a merge moves the duplicate's flags onto the kept
-- account; removing a member's personal info or deleting the account
-- removes their flags.
--
-- Server-only like the other staff tables: RLS on, no client policies
-- (the app reads and writes with the service role), functions for
-- service_role only. Additive and safe to run more than once.

create table if not exists member_flags (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null, -- no foreign key: see the top
  reason text not null check (reason in ('someone_elses_number', 'not_here', 'other')),
  note text check (note is null or length(note) <= 280),
  -- The check-in it was about. Gone (set null) once its points are taken
  -- back, which deletes the visit.
  visit_id uuid references member_visits(id) on delete set null,
  visit_date date, -- that check-in's business day, kept after the visit goes
  flagged_by uuid references employees(id) on delete set null,
  flagged_at timestamptz not null default now(),
  taken_back_by uuid references employees(id) on delete set null,
  taken_back_at timestamptz,
  taken_back_points integer,
  cleared_by uuid references employees(id) on delete set null,
  cleared_at timestamptz
);
create index if not exists member_flags_member_idx on member_flags (member_id, flagged_at desc);
create index if not exists member_flags_open_idx on member_flags (flagged_at desc) where cleared_at is null;
alter table member_flags enable row level security;

-- A merge (merge_members logs it in member_merges just before deleting the
-- duplicate): the duplicate's flags move to the kept account.
create or replace function public.member_flags_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update member_flags set member_id = new.keep_id where member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists member_flags_member_merged on member_merges;
create trigger member_flags_member_merged after insert on member_merges
  for each row execute function public.member_flags_member_merged();

-- Removing a member's personal info (erase_member_personal_info sets
-- erased_at) or deleting the account: their flags go (a note can name them).
create or replace function public.members_erase_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from member_flags where member_id = old.id;
    return old;
  end if;
  if new.erased_at is not null and old.erased_at is null then
    delete from member_flags where member_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_flags on members;
create trigger members_erase_flags after update of erased_at on members
  for each row execute function public.members_erase_flags();
drop trigger if exists members_delete_flags on members;
create trigger members_delete_flags after delete on members
  for each row execute function public.members_erase_flags();

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.member_flags_member_merged() from public, anon, authenticated;
revoke execute on function public.members_erase_flags() from public, anon, authenticated;
