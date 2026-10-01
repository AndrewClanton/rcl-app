-- Member profiles: an optional public page, the profile line, and check-in
-- flair. Additive and safe to run twice.
--
-- * A member can share a profile page at /m/<profile_handle>. It's off
--   until they turn it on (share_profile), and only ever shows what
--   src/lib/member-profile.ts whitelists: display_name (they choose it; the
--   account suggests first name and last initial), their photo, the profile
--   line, badges, week streak, visit count, member since, and movies seen
--   (this year's releases by name, older films only as a count, for the
--   MPLC license). Never purchases, points, email, phone or check-in times.
--   Handles are stored lowercase (the app normalizes them); a changed or
--   cleared handle stops working at once, and is held for 90 days
--   (member_retired_handles, below) so nobody else can take over links
--   the member already sent around.
-- * members.tagline is now the "profile line": on the shared page and on
--   the check-in screen when staff confirm them. Staff can hide an abusive
--   one (tagline_hidden_at/by): hidden, it shows nowhere, even after they
--   edit it, until staff show it again.
-- * Staff can also turn a shared page off (profile_hidden_at/by, say for a
--   rude display name or handle); the member can't turn it back on until
--   staff allow it again.
-- * Flair: a favorite color, an entrance effect and a sticker for the
--   check-in screen, as catalog keys (src/lib/flair.ts checks them, and
--   anything unknown plays as "classic"). birthday_party: a party effect in
--   their birthday week (on unless they turn it off).
--
-- Every read goes through the server with the service role: no new
-- policies, and members stays locked to anon and authenticated.

alter table members add column if not exists share_profile boolean not null default false;
alter table members add column if not exists profile_handle text;
alter table members add column if not exists display_name text;
alter table members add column if not exists tagline_hidden_at timestamptz;
alter table members add column if not exists tagline_hidden_by uuid references employees(id) on delete set null;
alter table members add column if not exists profile_hidden_at timestamptz;
alter table members add column if not exists profile_hidden_by uuid references employees(id) on delete set null;
alter table members add column if not exists flair_color text;
alter table members add column if not exists flair_effect text;
alter table members add column if not exists flair_sticker text;
alter table members add column if not exists birthday_party boolean not null default true;

do $$
begin
  -- 3 to 24 characters: a lowercase letter first, then letters, digits and
  -- single hyphens, not ending in one (the app's rule, handleProblem()).
  if not exists (select 1 from pg_constraint where conname = 'members_profile_handle_format') then
    alter table members add constraint members_profile_handle_format check (
      profile_handle is null
      or (profile_handle ~ '^[a-z][a-z0-9-]{1,22}[a-z0-9]$' and position('--' in profile_handle) = 0)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_display_name_length') then
    alter table members add constraint members_display_name_length check (display_name is null or char_length(display_name) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'members_flair_keys_length') then
    alter table members add constraint members_flair_keys_length check (
      (flair_color is null or char_length(flair_color) <= 24)
      and (flair_effect is null or char_length(flair_effect) <= 24)
      and (flair_sticker is null or char_length(flair_sticker) <= 24)
    );
  end if;
end $$;

-- One member per handle. (Lowercase by the check above, so this is
-- case-insensitive too.)
create unique index if not exists members_profile_handle_key on members (profile_handle) where profile_handle is not null;

comment on column members.tagline is
  'The profile line: a short line the member writes (120 characters or fewer). Shown on their shared profile page and on the check-in screen, unless staff hid it (tagline_hidden_at).';
comment on column members.share_profile is 'Their profile page at /m/<profile_handle> is on. Off by default.';
comment on column members.display_name is 'The name on their shared profile page (they choose it).';
comment on column members.profile_hidden_at is 'Staff turned their shared page off; they can''t turn it back on until staff allow it.';

-- ---------- removing a member's personal info ----------
-- erase_member_personal_info (20260929220000) sets erased_at and blanks the
-- tagline; when it does, the shared page, its handle and name, the flair
-- and the staff hide marks go too. The same trigger approach as
-- members_erase_badges (20260930030000), so the erase function itself
-- doesn't change.
create or replace function public.members_erase_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    new.share_profile := false;
    new.profile_handle := null;
    new.display_name := null;
    new.tagline_hidden_at := null;
    new.tagline_hidden_by := null;
    new.profile_hidden_at := null;
    new.profile_hidden_by := null;
    new.flair_color := null;
    new.flair_effect := null;
    new.flair_sticker := null;
    new.birthday_party := true;
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_profile on members;
create trigger members_erase_profile before update of erased_at on members
  for each row execute function public.members_erase_profile();

-- ---------- retired link names ----------
-- A link name someone stops using (they changed or cleared it, or their
-- account was erased) is held for 90 days (HANDLE_HOLD_DAYS in
-- src/lib/member-profile.ts). Otherwise someone else could pick it up at
-- once and show up, with a name and line of their choosing, at links the
-- first member already texted or posted. During the hold only the member
-- who had it can take it back; after an erase nobody can (member_id is
-- cleared, so the held name isn't tied to them), and it's simply released
-- when the 90 days are up. Holds are written and enforced here, by
-- triggers, so every way a handle changes is covered; the app maps the
-- refusal (unique_violation) to "someone has (or recently had) that link".
create table if not exists member_retired_handles (
  handle text primary key,
  member_id uuid references members(id) on delete cascade,
  retired_at timestamptz not null default now()
);
create index if not exists member_retired_handles_member_idx on member_retired_handles (member_id);
-- Server-only, like the rest: RLS on, no client policies.
alter table member_retired_handles enable row level security;
comment on table member_retired_handles is
  'Profile link names (members.profile_handle) given up in the last 90 days: only the member who had one (member_id) can take it back meanwhile. member_id is null after an erase.';

-- Before a handle is taken: refused if it's held for someone else.
create or replace function public.members_check_handle_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from member_retired_handles r
    where r.handle = new.profile_handle
      and r.member_id is distinct from new.id
      and r.retired_at > now() - interval '90 days'
  ) then
    raise exception 'profile link name % is held for its previous owner', new.profile_handle using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists members_check_handle_hold on members;
create trigger members_check_handle_hold before update of profile_handle on members
  for each row
  when (new.profile_handle is not null and new.profile_handle is distinct from old.profile_handle)
  execute function public.members_check_handle_hold();

-- After a handle changes (by the member, or by members_erase_profile on an
-- erase, which a column-list trigger wouldn't see): hold the old one, drop
-- the hold on one just taken back, clear the member from their holds on an
-- erase, and let expired holds go.
create or replace function public.members_retire_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.profile_handle is not null and old.profile_handle is distinct from new.profile_handle then
    insert into member_retired_handles (handle, member_id, retired_at)
    values (old.profile_handle, case when new.erased_at is null then new.id end, now())
    on conflict (handle) do update set member_id = excluded.member_id, retired_at = excluded.retired_at;
  end if;
  if new.profile_handle is not null and new.profile_handle is distinct from old.profile_handle then
    delete from member_retired_handles where handle = new.profile_handle;
  end if;
  if new.erased_at is not null and old.erased_at is null then
    update member_retired_handles set member_id = null where member_id = new.id;
  end if;
  delete from member_retired_handles where retired_at <= now() - interval '90 days';
  return null;
end;
$$;
drop trigger if exists members_retire_handle on members;
create trigger members_retire_handle after update on members
  for each row
  when (old.profile_handle is distinct from new.profile_handle or (new.erased_at is not null and old.erased_at is null))
  execute function public.members_retire_handle();
