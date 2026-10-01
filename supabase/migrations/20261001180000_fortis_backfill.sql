-- Points for card purchases made before the new system.
--
-- Until mid-September 2026 the Royale took cards through Fortis. Regulars
-- have years of card history but started the new system at 0 points.
-- scripts/load-fortis-cards.mjs reads Fortis's export and keeps one row per
-- card here, matched to a member where it can be (rules in
-- src/lib/fortis-backfill.ts). An owner or admin reviews the matches in
-- Back office (Members > Points from past card purchases) and presses
-- Grant; grant_fortis_backfill() then writes one points-history row per
-- member through apply_member_points, so the balance and the history agree.
--
--   - fortis_cards: one row per card, keyed by its first six and last four
--     digits (never more of the number), with what it spent, the business
--     days it was used, and its match. Unclaimed cards stay for later: when
--     someone claims a card or adds it to their account (the card-points
--     work matches on brand and last four), it can be linked here.
--   - fortis_backfill_grants: what each grant gave each member, with the
--     settings used. A card is granted once (granted_at); a member's cap
--     counts every earlier grant.
--   - points_ledger gets the reason 'backfill'.
--   - Removing a member's personal info clears the name and contact on the
--     cards matched to them and unlinks them.
--
-- Server-only like the rest: RLS on, no client policies. Additive and safe
-- to run more than once.

-- ---------- grants ----------
create table if not exists fortis_backfill_grants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  points numeric(10,2) not null check (points >= 0),
  dollars numeric(10,2) not null,
  cards int not null,
  settings jsonb not null, -- {rate, cap, taxOut} as chosen on the screen
  ledger_id uuid references points_ledger(id) on delete set null,
  granted_by uuid references employees(id) on delete set null,
  granted_at timestamptz not null default now()
);
create index if not exists fortis_backfill_grants_member_idx on fortis_backfill_grants (member_id);
alter table fortis_backfill_grants enable row level security;

-- ---------- cards ----------
create table if not exists fortis_cards (
  id uuid primary key default gen_random_uuid(),
  -- First six + last four digits. That much of a card number (a masked
  -- number) is all we keep, and all we'll ever ask for.
  card_key text not null unique check (card_key ~ '^[0-9]{10}$'),
  first_six text generated always as (left(card_key, 6)) stored,
  last_four text generated always as (right(card_key, 4)) stored,
  brand text, -- visa, mc, disc, amex
  -- The name it carried most, cleaned up ("John A Smith"), and every name
  -- it carried reduced for matching: first and last word ("john smith"),
  -- and all words ("john a smith").
  holder_name text,
  name_keys text[] not null default '{}',
  name_fulls text[] not null default '{}',
  -- Given with a payment, when there was one (lowercased email, 10 digits).
  contact_email text,
  contact_phone text,
  -- Approved sales less refunds. Voids and declines don't count. Dollars
  -- are as charged (sales tax in; the export doesn't split it out).
  sale_count int not null default 0,
  refund_count int not null default 0,
  sales_total numeric(10,2) not null default 0,
  refunds_total numeric(10,2) not null default 0,
  net_total numeric(10,2) generated always as (sales_total - refunds_total) stored,
  first_purchase_at timestamptz,
  last_purchase_at timestamptz,
  -- Business dates (4 a.m. to 4 a.m. Central) with an approved sale.
  visit_dates date[] not null default '{}',
  loaded_at timestamptz not null default now(),
  -- The match: matched (one member), needs_pick (candidate_member_ids), or
  -- unclaimed. match_kind says how, or why it needs a pick.
  match_status text not null default 'unclaimed' check (match_status in ('matched', 'needs_pick', 'unclaimed')),
  match_kind text check (match_kind in ('email', 'phone', 'name', 'similar', 'picked')),
  match_confidence text check (match_confidence in ('high', 'medium')),
  matched_member_id uuid references members(id) on delete set null,
  candidate_member_ids uuid[] not null default '{}',
  matched_at timestamptz,
  -- Staff review. Only 'approved' cards are granted.
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'skipped')),
  decided_by uuid references employees(id) on delete set null,
  decided_at timestamptz,
  -- Granted: once per card, ever. granted_points is this card's share of
  -- its member's grant.
  grant_id uuid references fortis_backfill_grants(id) on delete set null,
  granted_member_id uuid references members(id) on delete set null,
  granted_points numeric(10,2),
  granted_by uuid references employees(id) on delete set null,
  granted_at timestamptz,
  -- Its member's personal info was removed: name and contact are gone and
  -- a re-load doesn't bring them back.
  erased_at timestamptz
);
create index if not exists fortis_cards_member_idx on fortis_cards (matched_member_id) where matched_member_id is not null;
create index if not exists fortis_cards_last_four_idx on fortis_cards (last_four);
alter table fortis_cards enable row level security;

-- ---------- the 'backfill' points reason ----------
-- Adds 'backfill' to whatever reasons the check allows now (other work may
-- have added its own), rather than rewriting the list.
do $$
declare
  c text;
  def text;
  vals text[];
begin
  select conname, pg_get_constraintdef(oid) into c, def from pg_constraint
  where conrelid = 'public.points_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%';
  select array_agg(distinct m[1]) into vals from regexp_matches(coalesce(def, ''), '''([a-z_]+)''', 'g') as m;
  if vals is not null and 'backfill' = any(vals) then
    return;
  end if;
  if vals is null then
    vals := array['purchase', 'redeem', 'refund', 'welcome_bonus', 'adjustment', 'opening_balance', 'visit', 'badge'];
  end if;
  vals := array_append(vals, 'backfill'::text);
  if c is not null then
    execute format('alter table points_ledger drop constraint %I', c);
  end if;
  execute format(
    'alter table points_ledger add constraint points_ledger_reason_check check (reason in (%s))',
    (select string_agg(quote_literal(v), ', ' order by v) from unnest(vals) v)
  );
end $$;

-- ---------- granting ----------
-- p_grants: [{member_id, points, dollars, cards: [{id, points}]}], worked
-- out by the server (planGrant in src/lib/fortis-backfill.ts) from the
-- approved cards and the settings on the screen. Every card must still be
-- approved, still that member's and not yet granted, or nothing is written.
-- One points-history row per member, through apply_member_points. A second
-- press waits for the first, then finds its cards granted and stops.
create or replace function public.grant_fortis_backfill(p_grants jsonb, p_settings jsonb, p_note text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb;
  v_member uuid;
  v_points numeric;
  v_dollars numeric;
  v_ids uuid[];
  v_sum numeric;
  v_ok int;
  v_grant uuid;
  v_ledger uuid;
  v_members int := 0;
  v_total numeric := 0;
begin
  perform pg_advisory_xact_lock(hashtext('public.grant_fortis_backfill'));

  if jsonb_typeof(p_grants) <> 'array' then
    raise exception 'grant_fortis_backfill: grants must be a list' using errcode = '22023';
  end if;
  if (select count(distinct x->>'member_id') from jsonb_array_elements(p_grants) x) <> jsonb_array_length(p_grants) then
    raise exception 'grant_fortis_backfill: a member is listed twice' using errcode = '22023';
  end if;

  for g in select value from jsonb_array_elements(p_grants) loop
    v_member := (g->>'member_id')::uuid;
    v_points := (g->>'points')::numeric;
    v_dollars := coalesce((g->>'dollars')::numeric, 0);
    if v_member is null or v_points is null or v_points < 0 or v_points <> trunc(v_points) then
      raise exception 'grant_fortis_backfill: bad entry' using errcode = '22023';
    end if;
    select array_agg((x->>'id')::uuid), coalesce(sum((x->>'points')::numeric), 0)
      into v_ids, v_sum
      from jsonb_array_elements(g->'cards') x;
    if v_ids is null or v_sum <> v_points then
      raise exception 'grant_fortis_backfill: card shares don''t add up' using errcode = '22023';
    end if;

    -- Hold the cards so a decision can't change under us, then check them.
    perform 1 from fortis_cards where id = any(v_ids) for update;
    select count(*) into v_ok from fortis_cards
      where id = any(v_ids) and matched_member_id = v_member and decision = 'approved' and granted_at is null and erased_at is null;
    if v_ok <> cardinality(v_ids) then
      raise exception 'grant_fortis_backfill: cards changed' using errcode = 'P0001', hint = 'changed';
    end if;
    if not exists (select 1 from members where id = v_member and erased_at is null) then
      raise exception 'grant_fortis_backfill: member gone' using errcode = 'P0001', hint = 'changed';
    end if;

    v_ledger := null;
    if v_points > 0 then
      perform public.apply_member_points(v_member, v_points, 'backfill', null, null, p_note, p_by);
      select id into v_ledger from points_ledger
        where member_id = v_member and reason = 'backfill' and created_at = now()
        limit 1;
      v_members := v_members + 1;
      v_total := v_total + v_points;
    end if;

    insert into fortis_backfill_grants (member_id, points, dollars, cards, settings, ledger_id, granted_by)
      values (v_member, v_points, v_dollars, cardinality(v_ids), coalesce(p_settings, '{}'::jsonb), v_ledger, p_by)
      returning id into v_grant;

    update fortis_cards f
      set granted_at = now(),
          granted_by = p_by,
          grant_id = v_grant,
          granted_member_id = v_member,
          granted_points = (select (x->>'points')::numeric from jsonb_array_elements(g->'cards') x where (x->>'id')::uuid = f.id limit 1)
      where f.id = any(v_ids);
  end loop;

  return jsonb_build_object('members', v_members, 'points', v_total);
end;
$$;

-- ---------- removing a member's personal info ----------
-- erase_member_personal_info sets erased_at; when it does, the cards
-- matched to them lose the name and contact they carried and are unlinked.
-- A card already granted stays granted (it never pays twice); one that
-- wasn't is skipped.
create or replace function public.members_erase_fortis_cards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    update fortis_cards
      set holder_name = null,
          name_keys = '{}',
          name_fulls = '{}',
          contact_email = null,
          contact_phone = null,
          matched_member_id = null,
          granted_member_id = null,
          candidate_member_ids = '{}',
          match_status = 'unclaimed',
          match_kind = null,
          match_confidence = null,
          decision = case when granted_at is null then 'skipped' else decision end,
          erased_at = now()
      where matched_member_id = new.id or granted_member_id = new.id;
    update fortis_cards
      set candidate_member_ids = array_remove(candidate_member_ids, new.id)
      where new.id = any(candidate_member_ids);
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_fortis_cards on members;
create trigger members_erase_fortis_cards after update of erased_at on members
  for each row execute function public.members_erase_fortis_cards();

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.grant_fortis_backfill(jsonb, jsonb, text, uuid) from public, anon, authenticated;
revoke execute on function public.members_erase_fortis_cards() from public, anon, authenticated;
grant execute on function public.grant_fortis_backfill(jsonb, jsonb, text, uuid) to service_role;
