-- Points work like a bank account: the balance only ever moves by a row in
-- the points history (points_ledger), and each row says why. Staff no
-- longer type a new balance over the old one; they add or take away an
-- amount with a reason, and the member sees that reason.
--
-- 1. 'merge' joins the allowed reasons, for points brought over from a
--    duplicate account (labelled "Merged from a duplicate account").
-- 2. adjust_member_points(): the Back office's "Add or take away points".
-- 3. Anyone whose balance doesn't equal the sum of their history gets one
--    'opening_balance' row for the difference, so the two agree from here.
--
-- No trigger blocks direct updates of members.points (a merge function on
-- another branch sets it). scripts/check-points-ledger.mjs checks instead.

-- ---------- 1. reasons ----------
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.points_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%';
  if c is not null then execute format('alter table points_ledger drop constraint %I', c); end if;
end $$;
alter table points_ledger add constraint points_ledger_reason_check
  check (reason in ('purchase', 'redeem', 'refund', 'welcome_bonus', 'adjustment', 'opening_balance', 'visit', 'badge', 'merge'));

-- ---------- 2. a staff adjustment ----------
-- One 'adjustment' row through apply_member_points, the same path as every
-- other change, with the staff member's reason as the note.
--
-- p_expected is the balance the person confirmed ("Balance goes from X to
-- Y"). With the member's row locked:
--   * a different balance means something landed in between (a sale, a
--     check-in) or this is a second press of the same button: 'duplicate'
--     when the newest row is exactly this change, otherwise 'stale', and
--     nothing is written either way;
--   * taking away more than they have is refused ('negative');
--   * otherwise the row is written ('ok').
-- Returns {status, balance}.
create or replace function public.adjust_member_points(
  p_member uuid,
  p_delta numeric,
  p_note text,
  p_by uuid,
  p_expected numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_bal numeric;
  v_last points_ledger%rowtype;
  v_new numeric;
begin
  if p_delta is null or p_delta = 0 or p_delta <> trunc(p_delta) then
    raise exception 'An adjustment is a whole number of points, not zero.' using errcode = '22023';
  end if;
  if v_note = '' then
    raise exception 'An adjustment needs a reason.' using errcode = '22023';
  end if;

  select points into v_bal from members where id = p_member and erased_at is null for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_expected is null or v_bal <> p_expected then
    select * into v_last from points_ledger where member_id = p_member order by created_at desc, balance_after desc limit 1;
    if found and v_last.reason = 'adjustment' and v_last.delta = p_delta and v_last.note = v_note
       and v_last.created_by is not distinct from p_by and v_last.balance_after = v_bal
       and p_expected is not null and v_bal = p_expected + p_delta
       and v_last.created_at > now() - interval '10 minutes' then
      return jsonb_build_object('status', 'duplicate', 'balance', v_bal);
    end if;
    return jsonb_build_object('status', 'stale', 'balance', v_bal);
  end if;

  -- A balance already below zero (a refund after a redemption) can still
  -- be topped up; nothing takes one below zero.
  if p_delta < 0 and v_bal + p_delta < 0 then
    return jsonb_build_object('status', 'negative', 'balance', v_bal);
  end if;

  v_new := public.apply_member_points(p_member, p_delta, 'adjustment', null, null, v_note, p_by);
  return jsonb_build_object('status', 'ok', 'balance', v_new);
end;
$$;

revoke execute on function public.adjust_member_points(uuid, numeric, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.adjust_member_points(uuid, numeric, text, uuid, numeric) to service_role;

-- ---------- 3. balance = history, for everyone ----------
-- The difference goes in as the opening line of their history (just before
-- their first row; now, for someone with no history), since it's points
-- they had before the history accounted for them.
do $$
declare
  n int;
  total numeric;
begin
  with drift as (
    select m.id,
           m.points - coalesce(sum(l.delta), 0) as diff,
           min(l.created_at) as first_at
      from members m
      left join points_ledger l on l.member_id = m.id
     group by m.id, m.points
    having m.points <> coalesce(sum(l.delta), 0)
  ), ins as (
    insert into points_ledger (member_id, delta, balance_after, reason, note, created_at)
    select id, diff, diff, 'opening_balance', 'Balance before the points history began',
           coalesce(first_at - interval '1 second', now())
      from drift
    returning delta
  )
  select count(*), coalesce(sum(abs(delta)), 0) into n, total from ins;
  raise notice 'points reconcile: % member(s) given an opening balance row, % point(s) in total', n, total;
end $$;
