-- Find a card: a regular who only ever tapped (no name on the card) gives
-- staff the last 4 of their card and the date and amount of a purchase or
-- two from their banking app; Back office finds the card and a manager
-- assigns it to them (Members > Points from past card purchases).
--
--   - fortis_sales: one row per approved sale or refund from Fortis's
--     export, keyed by Fortis's own transaction id so a re-load updates in
--     place. Only the card's first six and last four, the business date,
--     the time and the amount (tax in, as charged): no names, no contact.
--     scripts/load-fortis-cards.mjs --apply fills it.
--   - fortis_cards.match_kind gets 'lookup': a card a staff member found
--     this way and assigned (decided_by and decided_at say who and when).
--   - grant_fortis_backfill is unchanged in what it takes, and now also
--     checks a cap against every earlier grant to the member inside its
--     lock. A member can be granted more than once (a card found later);
--     a card can't, ever.
--
-- Once a card is a member's (matched by name, picked, or found here), its
-- sales count as their visits before the new system. fortis_sales itself
-- names nobody: the only tie to a member is fortis_cards.matched_member_id
-- and granted_member_id, which removing a member's info already clears
-- (members_erase_fortis_cards), and the "card ending 1234" note goes with
-- their points history. So nothing new needs erasing.
--
-- Server-only like the rest: RLS on, no client policies. Additive and safe
-- to run more than once.

-- ---------- sales ----------
create table if not exists fortis_sales (
  id uuid primary key default gen_random_uuid(),
  fortis_id text not null unique, -- the export's "id" column
  -- First six + last four, the same key as fortis_cards.card_key. No
  -- foreign key: a card with only a refund on file has no fortis_cards row.
  card_key text not null check (card_key ~ '^[0-9]{10}$'),
  last_four text generated always as (right(card_key, 4)) stored,
  business_date date not null, -- 4 a.m. to 4 a.m. Central
  amount_cents int not null check (amount_cents > 0), -- as charged: tax in
  created_at timestamptz not null, -- when it was run
  kind text not null check (kind in ('sale', 'refund')),
  loaded_at timestamptz not null default now()
);
create index if not exists fortis_sales_day_amount_idx on fortis_sales (business_date, amount_cents);
create index if not exists fortis_sales_last_four_idx on fortis_sales (last_four);
create index if not exists fortis_sales_card_idx on fortis_sales (card_key);
alter table fortis_sales enable row level security;

-- ---------- 'lookup' ----------
alter table fortis_cards drop constraint if exists fortis_cards_match_kind_check;
alter table fortis_cards add constraint fortis_cards_match_kind_check
  check (match_kind in ('email', 'phone', 'name', 'similar', 'picked', 'lookup'));

-- ---------- granting ----------
-- As in 20261001180000_fortis_backfill.sql, plus: when p_settings has a
-- cap, a member's grants together never pass it, counted under the lock so
-- two grants at once (Back office's Grant and a "give these points now" at
-- the bar) can't both slip under it.
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
  v_cap numeric;
  v_before numeric;
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
  v_cap := case when jsonb_typeof(p_settings->'cap') = 'number' then floor((p_settings->>'cap')::numeric) end;

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
    if v_cap is not null and v_points > 0 then
      select coalesce(sum(points), 0) into v_before from fortis_backfill_grants where member_id = v_member;
      if v_before + v_points > v_cap then
        raise exception 'grant_fortis_backfill: over the cap' using errcode = 'P0001', hint = 'changed';
      end if;
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

revoke execute on function public.grant_fortis_backfill(jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_fortis_backfill(jsonb, jsonb, text, uuid) to service_role;
