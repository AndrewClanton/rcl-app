-- The Badge Case, build 1 (docs/cloud-handoff/badges, src/lib/badges/).
-- Badges become trading cards: a catalog of badge definitions in numbered
-- series, and a signed, frozen copy for every badge anyone earns.
--
--   badge_issuers  who issues badges (Royale Cinema Lounge today), with the
--                  public key its certificates verify against.
--   badge_holders  who holds them: a name and a phone/email identity,
--                  separate from the RCL member account (members links to
--                  one with badge_holder_id). Nothing here depends on RCL
--                  tables, so the registry can move out of this app.
--   badge_series   a frozen edition: Series 1 is drawn by generator gen-1.
--                  Its rarity thresholds are config.
--   badge_defs     the catalog: name, flavor text, rule, points, the art's
--                  parts spec and generator, set number, issuer.
--   badge_copies   each earned copy: serial, holder, mint time, stats, the
--                  rendered art as it was minted, and the issuer's Ed25519
--                  signature. Once signed, a copy never changes (a trigger
--                  refuses it); it can only be revoked.
--
-- member_badges stays what it is: the claim that pays a badge's points once
-- per member and period (award_member_visit, unchanged). Every claim gets a
-- copy (source_ref = 'member_badges:<id>'), minted by the app right after
-- (lib/badges/server.ts). A claim taken back (Undo, a merge's duplicate,
-- erasing a member) revokes its copy here, so the two never disagree, and
-- the code from before this keeps working untouched.
--
-- Additive and safe to run twice. Server-only: RLS on, no client policies.

-- ---------- issuers ----------
create table if not exists public.badge_issuers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  public_key text, -- Ed25519, SPKI DER as base64 (set by scripts/backfill-badges.mjs)
  verify_url_base text not null, -- a copy's page is this plus its code
  created_at timestamptz not null default now()
);
alter table public.badge_issuers enable row level security;
grant select, insert, update on public.badge_issuers to service_role;

insert into public.badge_issuers (slug, name, verify_url_base)
values ('rcl', 'Royale Cinema Lounge', 'https://www.royalecinemajoplin.com/b/')
on conflict (slug) do nothing;

-- ---------- holders ----------
create table if not exists public.badge_holders (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  phone text, -- ten digits
  email text, -- lowercased
  merged_into uuid references public.badge_holders(id),
  created_at timestamptz not null default now()
);
create index if not exists badge_holders_phone_idx on public.badge_holders (phone) where phone is not null;
create index if not exists badge_holders_email_idx on public.badge_holders (email) where email is not null;
create index if not exists badge_holders_merged_idx on public.badge_holders (merged_into) where merged_into is not null;
alter table public.badge_holders enable row level security;
grant select, insert, update on public.badge_holders to service_role;

alter table public.members add column if not exists badge_holder_id uuid references public.badge_holders(id) on delete set null;
create unique index if not exists members_badge_holder_idx on public.members (badge_holder_id) where badge_holder_id is not null;

-- ---------- series ----------
create table if not exists public.badge_series (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references public.badge_issuers(id),
  number int not null check (number > 0),
  name text not null,
  generator text not null, -- 'gen-1'
  -- A badge's rarity: its live copies over everyone holding any badge.
  -- At least `common` of holders: Common; `uncommon`: Uncommon; `rare`:
  -- Rare; fewer: Legendary.
  rarity_thresholds jsonb not null default '{"common": 0.5, "uncommon": 0.2, "rare": 0.05}'::jsonb,
  created_at timestamptz not null default now(),
  unique (issuer_id, number)
);
alter table public.badge_series enable row level security;
grant select, insert, update on public.badge_series to service_role;

insert into public.badge_series (issuer_id, number, name, generator)
select id, 1, 'Series 1', 'gen-1' from public.badge_issuers where slug = 'rcl'
on conflict (issuer_id, number) do nothing;

-- ---------- definitions ----------
create table if not exists public.badge_defs (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references public.badge_issuers(id),
  series_id uuid not null references public.badge_series(id),
  key text not null, -- member_badges.badge
  name text not null,
  flavor text not null default '',
  set_number int not null check (set_number > 0),
  -- How it's earned (lib/badges/rules.ts). event: build 2 hooks up
  -- attendance; manual: awarded by hand in Back office.
  rule_type text not null check (rule_type in ('first_visit', 'visit_count', 'week_streak', 'checkin_time', 'birthday_week', 'manual', 'event')),
  rule_params jsonb not null default '{}'::jsonb,
  period text not null default 'once' check (period in ('once', 'yearly')),
  points int not null default 0 check (points >= 0 and points <= 5000),
  reward text check (reward in ('popcorn', 'pizza')),
  cheer text, -- the tablet's banner; {name} is their first name
  form_label text, -- "Enamel pin"
  parts_spec jsonb not null, -- the art's recipe (lib/badges/art.ts)
  generator text not null, -- 'gen-1'
  minted_count int not null default 0, -- serials handed out so far
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer_id, key),
  unique (series_id, set_number)
);
alter table public.badge_defs enable row level security;
grant select, insert, update on public.badge_defs to service_role;

-- A definition with copies out keeps its face: the art, name, series and
-- set number its copies were minted from. (Flavor text, points, the rule
-- and switching it off can still change.)
create or replace function public.badge_defs_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.minted_count > 0 and (
    new.parts_spec is distinct from old.parts_spec or new.generator is distinct from old.generator
    or new.name is distinct from old.name or new.series_id is distinct from old.series_id
    or new.set_number is distinct from old.set_number or new.issuer_id is distinct from old.issuer_id
    or new.key is distinct from old.key
  ) then
    raise exception 'badge % has copies out: its art, name and number are frozen', old.key;
  end if;
  if new.minted_count < old.minted_count then
    raise exception 'badge serials only go up';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists badge_defs_frozen on public.badge_defs;
create trigger badge_defs_frozen before update on public.badge_defs
  for each row execute function public.badge_defs_frozen();

-- ---------- copies ----------
create table if not exists public.badge_copies (
  id uuid primary key, -- chosen by the app, part of the signed certificate
  def_id uuid not null references public.badge_defs(id),
  issuer_id uuid not null references public.badge_issuers(id),
  series int not null,
  serial int not null check (serial > 0),
  holder_id uuid not null references public.badge_holders(id),
  code text not null unique, -- the public verify page: /b/<code>
  minted_at timestamptz not null default date_trunc('milliseconds', now()),
  name text not null, -- the face as minted
  flavor text not null default '',
  generator text not null,
  stats jsonb not null default '{}'::jsonb,
  event_kind text, -- 'screening' or 'house_event' (build 2)
  event_ref text,
  event_label text,
  source_ref text unique, -- what earned it in the issuer's system: 'member_badges:<id>'
  art_svg text, -- null only while it's being minted
  art_hash text, -- sha256 of art_svg, hex
  signature text, -- Ed25519 over the canonical certificate, base64
  cert_version int not null default 1,
  revoked_at timestamptz,
  revoked_reason text,
  unique (def_id, serial)
);
create index if not exists badge_copies_holder_idx on public.badge_copies (holder_id);
alter table public.badge_copies enable row level security;
grant select, insert, update on public.badge_copies to service_role;

-- A signed copy never changes: only revoking it is allowed.
create or replace function public.badge_copies_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.signature is not null
     and (to_jsonb(new) - 'revoked_at' - 'revoked_reason') is distinct from (to_jsonb(old) - 'revoked_at' - 'revoked_reason') then
    raise exception 'badge copy % is issued and can''t change', old.id;
  end if;
  return new;
end;
$$;
drop trigger if exists badge_copies_frozen on public.badge_copies;
create trigger badge_copies_frozen before update on public.badge_copies
  for each row execute function public.badge_copies_frozen();

-- ---------- a member's holder ----------
-- Their holder, made the first time it's needed (one per member: the
-- member row is locked while it's made).
create or replace function public.badge_holder_for_member(p_member uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m members%rowtype;
  h uuid;
begin
  select * into m from members where id = p_member for update;
  if not found then
    raise exception 'member % not found', p_member;
  end if;
  if m.badge_holder_id is not null then
    return m.badge_holder_id;
  end if;
  insert into badge_holders (display_name, phone, email)
  values (
    nullif(trim(coalesce(nullif(trim(m.display_name), ''), m.name)), ''),
    case when right(regexp_replace(coalesce(m.phone_digits, m.phone, ''), '\D', '', 'g'), 10) ~ '^[2-9][0-9]{9}$'
      then right(regexp_replace(coalesce(m.phone_digits, m.phone, ''), '\D', '', 'g'), 10) end,
    nullif(lower(trim(coalesce(m.email, ''))), '')
  )
  returning id into h;
  update members set badge_holder_id = h where id = p_member;
  return h;
end;
$$;

-- ---------- minting ----------
-- Step one of minting a copy: the next serial for the badge (the badge row
-- is locked, so serials never repeat or skip), its face as of now, and the
-- stats. The app then draws the art, signs it and fills in art_svg,
-- art_hash and signature (step two). One copy per source_ref: asking again
-- returns the one already started. p_minted_at: when the claim was earned,
-- for a copy minted after the fact (the backfill, a repair); now otherwise.
drop function if exists public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text);
create or replace function public.badge_reserve_copy(
  p_def uuid, p_holder uuid, p_source text, p_id uuid, p_code text, p_stats jsonb,
  p_event_kind text default null, p_event_ref text default null, p_event_label text default null,
  p_minted_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d badge_defs%rowtype;
  s badge_series%rowtype;
  c badge_copies%rowtype;
begin
  if p_source is not null then
    select * into c from badge_copies where source_ref = p_source;
    if found then
      return to_jsonb(c);
    end if;
  end if;
  select * into d from badge_defs where id = p_def for update;
  if not found then
    raise exception 'badge % not found', p_def;
  end if;
  -- Locked: a second minting of the same source waits here, then finds it.
  if p_source is not null then
    select * into c from badge_copies where source_ref = p_source;
    if found then
      return to_jsonb(c);
    end if;
  end if;
  select * into s from badge_series where id = d.series_id;
  update badge_defs set minted_count = minted_count + 1 where id = d.id;
  insert into badge_copies (id, def_id, issuer_id, series, serial, holder_id, code, minted_at, name, flavor, generator, stats, event_kind, event_ref, event_label, source_ref)
  values (p_id, d.id, d.issuer_id, s.number, d.minted_count + 1, p_holder, p_code, date_trunc('milliseconds', coalesce(p_minted_at, now())),
    d.name, d.flavor, d.generator, coalesce(p_stats, '{}'::jsonb), p_event_kind, p_event_ref, p_event_label, p_source)
  returning * into c;
  return to_jsonb(c);
end;
$$;

-- ---------- awarding by hand ----------
-- A badge given by staff (Back office -> Badges): the claim, once per
-- member and period, and its points (capped like any badge's by
-- apply_member_points). Returns {awarded, id, balance}.
create or replace function public.award_member_badge(p_member uuid, p_key text, p_period text, p_points numeric, p_note text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claim uuid;
  bal numeric;
begin
  if exists (select 1 from members where id = p_member and erased_at is not null) then
    return jsonb_build_object('awarded', false, 'id', null, 'balance', null);
  end if;
  insert into member_badges (member_id, badge, period, points)
  values (p_member, p_key, coalesce(p_period, ''), coalesce(p_points, 0)::int)
  on conflict (member_id, badge, period) do nothing
  returning id into claim;
  if claim is not null and coalesce(p_points, 0) > 0 then
    perform public.apply_member_points(p_member, p_points, 'badge', null, null, p_note, p_by);
  end if;
  select points into bal from members where id = p_member;
  return jsonb_build_object('awarded', claim is not null, 'id', claim, 'balance', bal);
end;
$$;

-- ---------- keeping copies and claims in step ----------
-- A claim taken back (Undo on the tablet, a flagged check-in, a merge's
-- duplicate, erasing a member) revokes its copy. The copy itself stays
-- as it was minted.
create or replace function public.member_badges_revoke_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update badge_copies set revoked_at = now(), revoked_reason = 'Taken back'
  where source_ref = 'member_badges:' || old.id and revoked_at is null;
  return old;
end;
$$;
drop trigger if exists member_badges_revoke_copy on public.member_badges;
create trigger member_badges_revoke_copy after delete on public.member_badges
  for each row execute function public.member_badges_revoke_copy();

-- A merge moves claims to the member who stays: their holders merge too
-- (the one going points at the one staying), so the copies follow without
-- changing.
create or replace function public.member_badges_merge_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  h_old uuid;
  h_new uuid;
begin
  if new.member_id is distinct from old.member_id then
    select badge_holder_id into h_old from members where id = old.member_id;
    if h_old is not null then
      h_new := public.badge_holder_for_member(new.member_id);
      if h_new <> h_old then
        update badge_holders set merged_into = h_new where id = h_old or merged_into = h_old;
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists member_badges_merge_holder on public.member_badges;
create trigger member_badges_merge_holder after update of member_id on public.member_badges
  for each row execute function public.member_badges_merge_holder();

-- The holder's name and contact follow the member's; erasing a member
-- clears them.
create or replace function public.members_sync_badge_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.badge_holder_id is null then
    return new;
  end if;
  if new.erased_at is not null then
    update badge_holders set display_name = null, phone = null, email = null where id = new.badge_holder_id;
  elsif new.name is distinct from old.name or new.display_name is distinct from old.display_name
     or new.phone_digits is distinct from old.phone_digits or new.email is distinct from old.email then
    update badge_holders set
      display_name = nullif(trim(coalesce(nullif(trim(new.display_name), ''), new.name)), ''),
      phone = case when right(regexp_replace(coalesce(new.phone_digits, new.phone, ''), '\D', '', 'g'), 10) ~ '^[2-9][0-9]{9}$'
        then right(regexp_replace(coalesce(new.phone_digits, new.phone, ''), '\D', '', 'g'), 10) end,
      email = nullif(lower(trim(coalesce(new.email, ''))), '')
    where id = new.badge_holder_id;
  end if;
  return new;
end;
$$;
drop trigger if exists members_sync_badge_holder on public.members;
create trigger members_sync_badge_holder after update of name, display_name, phone_digits, email, erased_at on public.members
  for each row execute function public.members_sync_badge_holder();

-- ---------- grants ----------
revoke execute on function public.badge_holder_for_member(uuid) from public, anon, authenticated;
revoke execute on function public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.award_member_badge(uuid, text, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.badge_holder_for_member(uuid) to service_role;
grant execute on function public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text, timestamptz) to service_role;
grant execute on function public.award_member_badge(uuid, text, text, numeric, text, uuid) to service_role;
