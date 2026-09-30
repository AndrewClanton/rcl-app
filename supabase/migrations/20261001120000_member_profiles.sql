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
--   cleared handle simply stops working.
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
