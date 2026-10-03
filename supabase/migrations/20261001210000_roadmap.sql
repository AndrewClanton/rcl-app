-- What's new: one list that is both the changelog and the roadmap (Andrew
-- 10/1). The public site shows it at /whats-new (what's being built now,
-- what just shipped, what's next in line, ideas we're considering), each
-- item has its own page to share (/whats-new/<slug>), and Back office →
-- Roadmap runs it. scripts/roadmap.mjs lets the main Claude session keep
-- it current.
--
--   roadmap_items        the list. Only is_public rows ever reach a public
--                        page, and of those only the title, the public
--                        summary, the dates, the status, the queue position
--                        and (with credit_ok) the requester's first name and
--                        last initial. internal_notes never leave Back office.
--   roadmap_votes        "I want this too": one per member per item.
--   roadmap_notes        a member's private note to the crew about an item.
--                        Staff only, never shown publicly.
--   roadmap_suggestions  "Suggest something" from a signed-in member, or a
--                        request a manager logged for someone. The inbox in
--                        Back office accepts one (it becomes an item) or
--                        declines it.
--
-- No foreign keys to members, on purpose: merge_members() (20261001150000)
-- refuses to merge an account that any foreign key still points at, and a
-- vote shouldn't block a merge. Instead, triggers below keep these rows
-- right: a merge moves the duplicate's votes, notes, suggestions and
-- credit onto the kept account; removing a member's personal info
-- (erase_member_personal_info) or deleting the account removes their votes,
-- notes and suggestions and unlinks them from any item they're credited on.
--
-- Server-only like everything else: RLS on, no client policies, functions
-- for service_role only. Additive and safe to run more than once.

-- ---------- items ----------
create table if not exists roadmap_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (length(btrim(title)) between 1 and 120),
  -- Plain words a customer understands. Shown publicly when is_public.
  public_summary text not null default '' check (length(public_summary) <= 1000),
  -- Staff only.
  internal_notes text check (length(internal_notes) <= 4000),
  status text not null default 'idea' check (status in ('idea', 'queued', 'building', 'reviewing', 'live', 'not_doing')),
  -- Order within its status (the queue's order for 'queued'). The trigger
  -- below puts a new item, or one that just changed status, at the end.
  rank int not null default 0,
  is_public boolean not null default false,
  -- Who asked for it: a member, or a name typed by staff. Shown publicly
  -- only as "Suggested by Jake B." and only with credit_ok.
  requested_by_member_id uuid,
  requested_by_name text check (length(requested_by_name) <= 60),
  credit_ok boolean not null default false,
  -- The release it went out in (package.json's version when it went live).
  shipped_in_version text check (shipped_in_version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  shipped_at timestamptz,
  -- Every status it has been in, oldest first: [{"status": "queued", "at": "..."}].
  history jsonb not null default '[]'::jsonb
);
create index if not exists roadmap_items_status_rank_idx on roadmap_items (status, rank);
create index if not exists roadmap_items_requester_idx on roadmap_items (requested_by_member_id) where requested_by_member_id is not null;
alter table roadmap_items enable row level security;

-- Keeps the dates, the history and the order right however a row is
-- written (Back office, the CLI, the seed):
--   - a new row, or one whose status changed, goes to the end of its
--     status's list unless the same write set a rank;
--   - a status change stamps status_changed_at and adds to history;
--   - entering 'live' sets shipped_at, unless the same write set it.
create or replace function public.roadmap_items_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.rank is null or new.rank = 0 then
      select coalesce(max(rank), 0) + 1 into new.rank from roadmap_items where status = new.status;
    end if;
    if new.status = 'live' and new.shipped_at is null then
      new.shipped_at := now();
    end if;
    if new.history is null or new.history = '[]'::jsonb then
      new.history := jsonb_build_array(jsonb_build_object(
        'status', new.status,
        'at', case when new.status = 'live' then new.shipped_at else new.status_changed_at end));
    end if;
    return new;
  end if;

  -- "Updated" on the public page means something people can see changed,
  -- not a reorder or a staff note.
  if (new.title, new.public_summary, new.status, new.is_public, new.requested_by_member_id, new.requested_by_name, new.credit_ok)
     is distinct from (old.title, old.public_summary, old.status, old.is_public, old.requested_by_member_id, old.requested_by_name, old.credit_ok) then
    new.updated_at := now();
  end if;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.history := coalesce(old.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', new.status, 'at', now()));
    if new.rank is not distinct from old.rank then
      select coalesce(max(rank), 0) + 1 into new.rank from roadmap_items where status = new.status and id <> new.id;
    end if;
    if new.status = 'live' and new.shipped_at is not distinct from old.shipped_at then
      new.shipped_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists roadmap_items_stamp on roadmap_items;
create trigger roadmap_items_stamp before insert or update on roadmap_items
  for each row execute function public.roadmap_items_stamp();

-- ---------- votes ----------
create table if not exists roadmap_votes (
  item_id uuid not null references roadmap_items(id) on delete cascade,
  member_id uuid not null, -- no foreign key: see the top
  created_at timestamptz not null default now(),
  primary key (item_id, member_id)
);
create index if not exists roadmap_votes_member_idx on roadmap_votes (member_id);
alter table roadmap_votes enable row level security;

-- How many want each item, for the public page and Back office (a count
-- per item, so a popular item never runs into a row limit).
create or replace function public.roadmap_vote_counts(p_items uuid[])
returns table (item_id uuid, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.item_id, count(*) from roadmap_votes v where v.item_id = any(p_items) group by v.item_id;
$$;

-- ---------- private notes to the crew ----------
create table if not exists roadmap_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references roadmap_items(id) on delete cascade,
  member_id uuid not null, -- no foreign key: see the top
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists roadmap_notes_item_idx on roadmap_notes (item_id, created_at desc);
create index if not exists roadmap_notes_member_idx on roadmap_notes (member_id);
alter table roadmap_notes enable row level security;

-- ---------- suggestions inbox ----------
create table if not exists roadmap_suggestions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid, -- the member who suggested it (no foreign key: see the top)
  name text check (length(name) <= 60), -- or a name, when staff logged someone's request
  body text not null check (length(btrim(body)) between 1 and 1000),
  credit_ok boolean not null default false, -- "Credit me if it's built"
  status text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  item_id uuid references roadmap_items(id) on delete set null, -- what it became
  logged_by uuid references employees(id) on delete set null, -- staff who logged it, if not the member
  decided_by uuid references employees(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (member_id is not null or name is not null or logged_by is not null)
);
create index if not exists roadmap_suggestions_status_idx on roadmap_suggestions (status, created_at desc);
create index if not exists roadmap_suggestions_member_idx on roadmap_suggestions (member_id) where member_id is not null;
alter table roadmap_suggestions enable row level security;

-- ---------- members merged, removed or deleted ----------
-- A merge (merge_members logs it in member_merges just before deleting
-- the duplicate): the duplicate's votes, notes, suggestions and credit move
-- to the kept account. A vote on an item both accounts voted for is kept once.
create or replace function public.roadmap_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from roadmap_votes dv using roadmap_votes kv
   where dv.member_id = new.dropped_id and kv.member_id = new.keep_id and kv.item_id = dv.item_id;
  update roadmap_votes set member_id = new.keep_id where member_id = new.dropped_id;
  update roadmap_notes set member_id = new.keep_id where member_id = new.dropped_id;
  update roadmap_suggestions set member_id = new.keep_id where member_id = new.dropped_id;
  update roadmap_items set requested_by_member_id = new.keep_id where requested_by_member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists roadmap_member_merged on member_merges;
create trigger roadmap_member_merged after insert on member_merges
  for each row execute function public.roadmap_member_merged();

-- Removing a member's personal info (erase_member_personal_info sets
-- erased_at) or deleting the account: their votes, notes and suggestions
-- go, and any item they're credited on forgets them (no link, no name, no
-- credit). The item itself stays: its public words are the Royale's.
create or replace function public.roadmap_forget_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from roadmap_votes where member_id = p_member;
  delete from roadmap_notes where member_id = p_member;
  delete from roadmap_suggestions where member_id = p_member;
  update roadmap_items
     set requested_by_member_id = null, requested_by_name = null, credit_ok = false
   where requested_by_member_id = p_member;
end;
$$;

create or replace function public.members_erase_roadmap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform roadmap_forget_member(old.id);
    return old;
  end if;
  if new.erased_at is not null and old.erased_at is null then
    perform roadmap_forget_member(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_roadmap on members;
create trigger members_erase_roadmap after update of erased_at on members
  for each row execute function public.members_erase_roadmap();
drop trigger if exists members_delete_roadmap on members;
create trigger members_delete_roadmap after delete on members
  for each row execute function public.members_erase_roadmap();

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.roadmap_items_stamp() from public, anon, authenticated;
revoke execute on function public.roadmap_member_merged() from public, anon, authenticated;
revoke execute on function public.roadmap_forget_member(uuid) from public, anon, authenticated;
revoke execute on function public.members_erase_roadmap() from public, anon, authenticated;
revoke execute on function public.roadmap_vote_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.roadmap_vote_counts(uuid[]) to service_role;
