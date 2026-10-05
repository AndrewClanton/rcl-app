-- Account notes and a "Group / organization" label (Andrew, 10/5): "Three
-- people just logged in with phone accounts, and I want to note that they
-- are with Easter Seals and will be attributed to a corporate account
-- later." Staff add notes from the register's press-and-hold panel
-- (pos/MemberGlance.tsx) and the member's Back office page; the label holds
-- people until real corporate accounts exist, and Back office's Members
-- list filters by it.
--
--   member_notes          one row per note: the text (1-500 characters),
--                         the employee who wrote it, when.
--   members.organization  free text, e.g. "Easter Seals". Null for most.
--
-- Staff only: never on the customer screen, My Account, the profile or
-- emails (nothing customer-facing selects member_notes; the label is read
-- only by staff pages).
--
-- No foreign key from member_notes to members, on purpose (like
-- member_flags, 20261002060000): merge_members() (20261001150000) refuses to
-- merge an account that any foreign key still points at. Triggers keep the
-- rows right instead: a merge moves the duplicate's notes (and its label,
-- when the kept account has none) onto the kept account; removing a
-- member's personal info or deleting the account removes their notes and
-- label.
--
-- Server-only like the other staff tables: RLS on, no client policies
-- (the app reads and writes with the service role). Additive and safe to
-- run more than once.

alter table members add column if not exists organization text
  check (organization is null or length(organization) between 1 and 80);
create index if not exists members_organization_idx on members (lower(organization)) where organization is not null;

create table if not exists member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null, -- no foreign key: see the top
  note text not null check (length(note) between 1 and 500),
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists member_notes_member_idx on member_notes (member_id, created_at desc);
alter table member_notes enable row level security;
grant select, insert, delete on public.member_notes to service_role;

-- A merge (merge_members logs it in member_merges just before deleting the
-- duplicate, so both rows are still there).
create or replace function public.member_notes_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update member_notes set member_id = new.keep_id where member_id = new.dropped_id;
  update members k set organization = d.organization
    from members d
    where k.id = new.keep_id and d.id = new.dropped_id and k.organization is null and d.organization is not null;
  return null;
end;
$$;
drop trigger if exists member_notes_member_merged on member_merges;
create trigger member_notes_member_merged after insert on member_merges
  for each row execute function public.member_notes_member_merged();

-- Removing a member's personal info or deleting the account: their notes
-- and label go (a note can name them).
create or replace function public.members_erase_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from member_notes where member_id = old.id;
    return old;
  end if;
  if new.erased_at is not null and old.erased_at is null then
    delete from member_notes where member_id = new.id;
    update members set organization = null where id = new.id and organization is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_notes on members;
create trigger members_erase_notes after update of erased_at on members
  for each row execute function public.members_erase_notes();
drop trigger if exists members_delete_notes on members;
create trigger members_delete_notes after delete on members
  for each row execute function public.members_erase_notes();

revoke execute on function public.member_notes_member_merged() from public, anon, authenticated;
revoke execute on function public.members_erase_notes() from public, anon, authenticated;
