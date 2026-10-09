-- Past card purchases (Fortis), finished: one grant per card, the 1,000
-- point approval line, and claiming a card at the register.
--
--   - grant_fortis_card(card, member, by, mode): one card's points to one
--     member, 1 point per $1 of what it spent (net of refunds), rounded
--     down. Through apply_member_points with the reason 'backfill', which
--     no daily earning cap touches, and the note "Past purchases (old
--     register): $X". A card pays once, ever (granted_at, under the same
--     lock as grant_fortis_backfill). An erased member is never paid.
--       mode 'auto'     scripts/grant-fortis-auto.mjs: only a high-confidence
--                       match (email, phone or the whole name) to this
--                       member, and only when the member's past-purchase
--                       points stay at 1,000 or under. Otherwise nothing.
--       mode 'register' the register's "Claim": an unclaimed or needs-pick
--                       card (or one already this member's) becomes theirs
--                       (match_kind 'register'). 1,000 or under is paid
--                       now; over that it waits in Back office's Needs
--                       approval, and the result says 'queued'.
--       mode 'approve'  a manager's Approve or Reassign in Needs approval:
--                       any amount, to the member they chose.
--   - fortis_card_rejections: "Not theirs" at the register (and Reject in
--     Needs approval) for one member, so the card isn't offered to them
--     again.
--   - fortis_cards.match_kind gets 'register'.
--   - Removing a member's personal info also drops their rejections.
--
-- Old code never calls the new function or reads the new table, so this is
-- safe to apply before the code that uses it. Additive and safe to run more
-- than once.

-- ---------- 'register' ----------
alter table fortis_cards drop constraint if exists fortis_cards_match_kind_check;
alter table fortis_cards add constraint fortis_cards_match_kind_check
  check (match_kind in ('email', 'phone', 'name', 'similar', 'picked', 'lookup', 'register'));

-- ---------- rejections ----------
create table if not exists fortis_card_rejections (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references fortis_cards(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  source text not null check (source in ('register', 'backoffice')),
  rejected_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (card_id, member_id)
);
create index if not exists fortis_card_rejections_member_idx on fortis_card_rejections (member_id);
alter table fortis_card_rejections enable row level security;
grant select, insert, update, delete on public.fortis_card_rejections to service_role;

-- ---------- one card's grant ----------
create or replace function public.grant_fortis_card(p_card uuid, p_member uuid, p_by uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c fortis_cards%rowtype;
  v_points numeric;
  v_before numeric;
  v_small boolean;
  v_ledger uuid;
  v_grant uuid;
  v_note text;
begin
  if p_mode not in ('auto', 'register', 'approve') then
    raise exception 'grant_fortis_card: bad mode' using errcode = '22023';
  end if;
  -- The same lock as grant_fortis_backfill: one grant at a time, so a card
  -- can't be paid twice and a member's total is read fresh.
  perform pg_advisory_xact_lock(hashtext('public.grant_fortis_backfill'));

  select * into c from fortis_cards where id = p_card for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if c.granted_at is not null then
    return jsonb_build_object('status', 'already', 'points', c.granted_points, 'member', c.granted_member_id);
  end if;
  if c.erased_at is not null then
    return jsonb_build_object('status', 'removed');
  end if;
  if not exists (select 1 from members where id = p_member and erased_at is null) then
    return jsonb_build_object('status', 'member_gone');
  end if;

  v_points := floor(greatest(c.net_total, 0));
  select coalesce(sum(points), 0) into v_before from fortis_backfill_grants where member_id = p_member;
  v_small := v_points <= 1000 and v_before + v_points <= 1000;

  if p_mode = 'auto' then
    if c.match_status <> 'matched' or c.matched_member_id is distinct from p_member or c.match_confidence is distinct from 'high'
       or c.match_kind not in ('email', 'phone', 'name') or c.decision = 'skipped'
       or exists (select 1 from fortis_card_rejections r where r.card_id = c.id and r.member_id = p_member) then
      return jsonb_build_object('status', 'not_eligible');
    end if;
    if not v_small then
      return jsonb_build_object('status', 'needs_approval', 'points', v_points);
    end if;
  elsif p_mode = 'register' then
    if c.decision = 'skipped'
       or exists (select 1 from fortis_card_rejections r where r.card_id = c.id and r.member_id = p_member)
       or not (c.match_status in ('unclaimed', 'needs_pick') or c.matched_member_id = p_member) then
      return jsonb_build_object('status', 'taken');
    end if;
    update fortis_cards
      set matched_member_id = p_member,
          match_status = 'matched',
          match_kind = 'register',
          match_confidence = null,
          matched_at = now(),
          decision = case when v_small then 'approved' else 'pending' end,
          decided_by = case when v_small then p_by else null end,
          decided_at = case when v_small then now() else null end
      where id = c.id;
    if not v_small then
      return jsonb_build_object('status', 'queued', 'points', v_points);
    end if;
  else
    -- approve: the manager's choice of member stands.
    update fortis_cards
      set matched_member_id = p_member,
          match_status = 'matched',
          match_kind = case when c.matched_member_id = p_member then c.match_kind else 'picked' end,
          match_confidence = case when c.matched_member_id = p_member then c.match_confidence else null end,
          matched_at = case when c.matched_member_id = p_member then c.matched_at else now() end
      where id = c.id;
  end if;

  update fortis_cards
    set decision = 'approved',
        decided_by = coalesce(p_by, decided_by),
        decided_at = now()
    where id = c.id;

  v_note := 'Past purchases (old register): $' || to_char(greatest(c.net_total, 0), 'FM999,999,990.00');
  v_ledger := null;
  if v_points > 0 then
    perform public.apply_member_points(p_member, v_points, 'backfill', null, null, v_note, p_by);
    select id into v_ledger from points_ledger
      where member_id = p_member and reason = 'backfill' and created_at = now()
      order by id desc limit 1;
  end if;

  insert into fortis_backfill_grants (member_id, points, dollars, cards, settings, ledger_id, granted_by)
    values (p_member, v_points, greatest(c.net_total, 0), 1,
            jsonb_build_object('rate', 1, 'rounding', 'down', 'taxOut', false, 'via', p_mode), v_ledger, p_by)
    returning id into v_grant;

  update fortis_cards
    set granted_at = now(),
        granted_by = p_by,
        grant_id = v_grant,
        granted_member_id = p_member,
        granted_points = v_points
    where id = c.id;

  return jsonb_build_object('status', 'granted', 'points', v_points);
end;
$$;
revoke execute on function public.grant_fortis_card(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.grant_fortis_card(uuid, uuid, uuid, text) to service_role;

-- ---------- removing a member's personal info ----------
-- As in 20261001180000_fortis_backfill.sql, plus their rejections go.
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
    delete from fortis_card_rejections where member_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.members_erase_fortis_cards() from public, anon, authenticated;
