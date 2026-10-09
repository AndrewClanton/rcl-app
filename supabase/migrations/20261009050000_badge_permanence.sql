-- The Badge Case: the permanence rule (Andrew, Oct 9 2026: badges "have to
-- be scarce yet concrete"). The rule in full is in src/lib/badges/server.ts
-- ("The permanence rule"); in short, a minted copy is never taken back:
--
--   * Refunds and returned tickets never revoke one. Nothing here or in
--     lib/badges/attendance.ts looks at a booking after the badge is earned.
--   * A copy minted from a check-in seals 10 minutes after it's minted. A
--     check-in undone before then takes its copy with it (badge_undo_claims,
--     called by lib/visits-server.ts undoVisit); its serial is retired, never
--     reused. After that the copy stays, whatever happens to the claim.
--   * Merging two accounts moves the dropped one's copies to the kept one's
--     holder: same serial, same mint data, a "transferred" line in the
--     copy's history with the signature it had (the certificate covers the
--     holder, so the app re-signs it: badge_resign_copy).
--   * Erasing a member's data removes their copies and retires the serials
--     forever. "#n of N" keeps counting them (badge_retired_serials).
--   * Fraud: a manager voids a copy with a reason (badge_void_copy). It is
--     never deleted, and a void can't be undone.
--
-- Enforced here: badge_copies_guard_delete refuses every delete except the
-- two paths above (erase, and an unsealed copy's undo).
--
-- Additive and safe to run twice. Server-only: RLS on, no client policies.

-- ---------- copies: void, history, re-signing ----------
alter table public.badge_copies add column if not exists voided_at timestamptz;
alter table public.badge_copies add column if not exists voided_reason text;
alter table public.badge_copies add column if not exists voided_by uuid;
-- What happened to it after minting, oldest first: {kind: 'transferred',
-- at, note, from_holder, to_holder, signature, cert_version} or {kind:
-- 'voided', at, reason, by}. Only ever grows.
alter table public.badge_copies add column if not exists history jsonb not null default '[]'::jsonb;
-- Moved to another holder and waiting for the app to sign it for them.
alter table public.badge_copies add column if not exists resign_pending boolean not null default false;
create index if not exists badge_copies_resign_idx on public.badge_copies (id) where resign_pending;

-- ---------- retired serials ----------
-- A serial whose copy is gone: erased (it was minted and counts in "of N")
-- or undone inside the grace window (it never sealed and doesn't). Never
-- handed out again: badge_defs.minted_count only goes up.
create table if not exists public.badge_retired_serials (
  def_id uuid not null references public.badge_defs(id),
  serial int not null check (serial > 0),
  copy_id uuid not null, -- no foreign key: the copy is gone
  reason text not null check (reason in ('erased', 'unsealed')),
  retired_at timestamptz not null default now(),
  primary key (def_id, serial)
);
alter table public.badge_retired_serials enable row level security;
grant select on public.badge_retired_serials to service_role;

-- ---------- a signed copy never changes ----------
-- Replaces build 1's: still frozen, except revoking (build 1), voiding
-- (once, for good), its history (only added to), and a transfer or its
-- re-signing (rcl.badge_reseal, set only by the functions below).
create or replace function public.badge_copies_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  free text[] := array['revoked_at', 'revoked_reason', 'voided_at', 'voided_reason', 'voided_by', 'history'];
  n int := jsonb_array_length(coalesce(old.history, '[]'::jsonb));
begin
  if old.signature is null and coalesce(current_setting('rcl.badge_reseal', true), '') <> 'on' then
    return new;
  end if;
  if old.voided_at is not null and (new.voided_at is distinct from old.voided_at or new.voided_reason is distinct from old.voided_reason or new.voided_by is distinct from old.voided_by) then
    raise exception 'badge copy % is void, and stays void', old.id;
  end if;
  if jsonb_typeof(new.history) <> 'array' or jsonb_array_length(new.history) < n
     or coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(new.history) with ordinality t(e, i) where i <= n), '[]'::jsonb) <> coalesce(old.history, '[]'::jsonb) then
    raise exception 'badge copy % history only grows', old.id;
  end if;
  if coalesce(current_setting('rcl.badge_reseal', true), '') = 'on' then
    free := free || array['holder_id', 'signature', 'resign_pending'];
  end if;
  if (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
    raise exception 'badge copy % is issued and can''t change', old.id;
  end if;
  return new;
end;
$$;

-- ---------- no deletes, except two ----------
-- PERMANENCE RULE (src/lib/badges/server.ts, "The permanence rule"): a
-- copy is never deleted, except by erasing a member's data
-- (badge_erase_holder_copies) or undoing a check-in within 10 minutes of
-- the copy's minting (badge_undo_claims). Both set rcl.badge_delete for
-- their own transaction; anything else is refused here.
create or replace function public.badge_copies_guard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  why text := coalesce(current_setting('rcl.badge_delete', true), '');
begin
  if why = 'erase' then
    return old;
  end if;
  if why = 'unsealed' and old.voided_at is null and old.minted_at > now() - interval '10 minutes' then
    return old;
  end if;
  raise exception 'badge copy % is permanent: only an erasure or an undo within 10 minutes removes one', old.id;
end;
$$;
drop trigger if exists badge_copies_guard_delete on public.badge_copies;
create trigger badge_copies_guard_delete before delete on public.badge_copies
  for each row execute function public.badge_copies_guard_delete();

-- ---------- a claim taken back no longer touches its copy ----------
-- Build 1 revoked the copy here. Under the permanence rule, deleting a
-- claim (a merge's duplicate, an Undo, an erasure) leaves the copy alone:
-- each of those handles its copies itself.
create or replace function public.member_badges_revoke_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return old;
end;
$$;

-- ---------- minting: not for a claim that's gone ----------
-- Build 1's, plus: a claim undone before its copy was reserved gets none.
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
    if p_source like 'member_badges:%' and not exists (
      select 1 from member_badges where id::text = substr(p_source, 15)
    ) then
      return null;
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

-- ---------- undo inside the grace window ----------
-- A check-in undone (lib/visits-server.ts undoVisit, after its claims are
-- deleted): each claim's copy goes if it hasn't sealed (minted under 10
-- minutes ago, not void), its serial retired. A sealed one stays.
-- Returns {removed, kept}.
create or replace function public.badge_undo_claims(p_claims uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c badge_copies%rowtype;
  removed int := 0;
  kept int := 0;
begin
  perform set_config('rcl.badge_delete', 'unsealed', true);
  for c in
    select * from badge_copies
     where source_ref = any (select 'member_badges:' || x::text from unnest(coalesce(p_claims, '{}'::uuid[])) x)
     for update
  loop
    if c.voided_at is null and c.minted_at > now() - interval '10 minutes' then
      insert into badge_retired_serials (def_id, serial, copy_id, reason)
      values (c.def_id, c.serial, c.id, 'unsealed')
      on conflict (def_id, serial) do nothing;
      delete from badge_copies where id = c.id;
      removed := removed + 1;
    else
      kept := kept + 1;
    end if;
  end loop;
  perform set_config('rcl.badge_delete', '', true);
  return jsonb_build_object('removed', removed, 'kept', kept);
end;
$$;

-- ---------- erasure ----------
-- Every copy of a holder (and of holders merged into it) goes, its serial
-- retired for good. Returns how many.
create or replace function public.badge_erase_holder_copies(p_holder uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  if p_holder is null then
    return 0;
  end if;
  perform set_config('rcl.badge_delete', 'erase', true);
  insert into badge_retired_serials (def_id, serial, copy_id, reason)
  select def_id, serial, id, 'erased' from badge_copies
   where holder_id = p_holder or holder_id in (select id from badge_holders where merged_into = p_holder)
  on conflict (def_id, serial) do nothing;
  delete from badge_copies
   where holder_id = p_holder or holder_id in (select id from badge_holders where merged_into = p_holder);
  get diagnostics n = row_count;
  perform set_config('rcl.badge_delete', '', true);
  return n;
end;
$$;

-- erase_member_personal_info sets erased_at; then their birthday, badge
-- claims (20260930030000) and now their badge copies go.
create or replace function public.members_erase_badges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    new.birthday := null;
    perform public.badge_erase_holder_copies(new.badge_holder_id);
    delete from member_badges where member_id = new.id;
  end if;
  return new;
end;
$$;

-- ---------- merges transfer ----------
-- Every copy of p_from (and of holders merged into it) moves to p_to:
-- same serial and mint data, its old signature kept in its history, and
-- marked for the app to sign for its new holder (badge_resign_copy). Then
-- p_from points at p_to. Returns how many moved.
create or replace function public.badge_transfer_holder(p_from uuid, p_to uuid, p_note text default 'accounts combined')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return 0;
  end if;
  perform set_config('rcl.badge_reseal', 'on', true);
  update badge_copies set
    history = history || jsonb_build_array(jsonb_build_object(
      'kind', 'transferred',
      'at', date_trunc('milliseconds', now()),
      'note', coalesce(p_note, 'accounts combined'),
      'from_holder', holder_id,
      'to_holder', p_to,
      'signature', signature,
      'cert_version', cert_version
    )),
    holder_id = p_to,
    resign_pending = signature is not null
  where holder_id = p_from or holder_id in (select id from badge_holders where merged_into = p_from);
  get diagnostics n = row_count;
  perform set_config('rcl.badge_reseal', '', true);
  update badge_holders set merged_into = p_to where (id = p_from or merged_into = p_from) and id <> p_to;
  return n;
end;
$$;

-- merge_members logs the merge in member_merges just before deleting the
-- dropped account: its copies move to the kept account's holder then.
create or replace function public.member_merges_transfer_badges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  h_drop uuid;
  h_keep uuid;
begin
  select badge_holder_id into h_drop from members where id = new.dropped_id;
  if h_drop is null or not exists (select 1 from badge_copies where holder_id = h_drop or holder_id in (select id from badge_holders where merged_into = h_drop)) then
    return new;
  end if;
  h_keep := public.badge_holder_for_member(new.keep_id);
  perform public.badge_transfer_holder(h_drop, h_keep, 'accounts combined');
  return new;
end;
$$;
drop trigger if exists member_merges_transfer_badges on public.member_merges;
create trigger member_merges_transfer_badges after insert on public.member_merges
  for each row execute function public.member_merges_transfer_badges();

-- The app's new signature for a transferred copy. p_from: the signature
-- it read (two re-signings at once write once). True if it was written.
create or replace function public.badge_resign_copy(p_id uuid, p_from text, p_signature text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform set_config('rcl.badge_reseal', 'on', true);
  update badge_copies set signature = p_signature, resign_pending = false
   where id = p_id and resign_pending and signature is not distinct from p_from;
  get diagnostics n = row_count;
  perform set_config('rcl.badge_reseal', '', true);
  return n > 0;
end;
$$;

-- ---------- void ----------
-- Fraud: a manager voids a copy with a reason (Back office -> Badges -> a
-- copy). It stays, marked VOID, forever. Returns {ok, def_id}; ok false if
-- there's no such copy or it's already void.
create or replace function public.badge_void_copy(p_code text, p_reason text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c badge_copies%rowtype;
  why text := left(trim(coalesce(p_reason, '')), 200);
begin
  if char_length(why) < 3 then
    raise exception 'a void needs a reason';
  end if;
  update badge_copies set
    voided_at = date_trunc('milliseconds', now()),
    voided_reason = why,
    voided_by = p_by,
    history = history || jsonb_build_array(jsonb_build_object('kind', 'voided', 'at', date_trunc('milliseconds', now()), 'reason', why, 'by', p_by))
  where code = p_code and voided_at is null
  returning * into c;
  if not found then
    return jsonb_build_object('ok', false, 'def_id', null);
  end if;
  return jsonb_build_object('ok', true, 'def_id', c.def_id);
end;
$$;

-- ---------- grants ----------
revoke execute on function public.badge_undo_claims(uuid[]) from public, anon, authenticated;
revoke execute on function public.badge_erase_holder_copies(uuid) from public, anon, authenticated;
revoke execute on function public.badge_transfer_holder(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.badge_resign_copy(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.badge_void_copy(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.badge_undo_claims(uuid[]) to service_role;
grant execute on function public.badge_resign_copy(uuid, text, text) to service_role;
grant execute on function public.badge_void_copy(text, text, uuid) to service_role;
grant execute on function public.badge_reserve_copy(uuid, uuid, text, uuid, text, jsonb, text, text, text, timestamptz) to service_role;
