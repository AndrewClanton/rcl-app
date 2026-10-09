-- The $5 off takes only the points it uses (Andrew's call, Oct 9): a $5
-- reward on a $3 order takes $3.00 off and 60 points (20 a dollar,
-- lib/loyalty.ts rewardPointsFor), and the other 40 stay in the balance.
--
-- redeem_order_points (20261008030000) already takes the points from the
-- caller (p_discount_points, now prorated by completeOrder). This replaces
-- it in place (same arguments, same grants) so that:
--   - the ledger note says what came off: "$3.00 off order #1234", from the
--     order's own redemption_discount (lib/points-history.ts rewardOff reads
--     it), not always "$5 off";
--   - the redemption's real_cost is prorated the same way (the catalog's $5
--     cost x points / 100);
--   - p_discount_points is never taken as more than 100.
-- Refunds need nothing new: reverse_purchase_points gives back the sum of
-- the order's redeem rows, which is exactly what was taken.

create or replace function public.redeem_order_points(p_member uuid, p_order uuid, p_items jsonb, p_discount_points integer default 0, p_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  r reward_catalog%rowtype;
  q integer;
  pts integer;
  v_bal numeric;
  v_earned numeric;
  v_num bigint;
  v_off numeric;
  v_problem text;
  short jsonb := '[]'::jsonb;
  used integer := 0;
  v_discount boolean := false;
  v_dpts integer := least(100, greatest(0, coalesce(p_discount_points, 0)));
begin
  if p_member is null or p_order is null then return jsonb_build_object('status', 'none'); end if;
  perform 1 from orders where id = p_order for update;
  if exists (select 1 from reward_redemptions where order_id = p_order) then
    return jsonb_build_object('status', 'done');
  end if;
  select points into v_bal from members where id = p_member for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select order_number, redemption_discount into v_num, v_off from orders where id = p_order;
  -- What came off: the order's own figure; the points' worth if it has none.
  if coalesce(v_off, 0) <= 0 then v_off := round(v_dpts * 0.05, 2); end if;

  -- The $5 off first, against the balance before this sale's own points.
  if v_dpts > 0 then
    select coalesce(sum(delta), 0) into v_earned from points_ledger
     where order_id = p_order and member_id = p_member and reason = 'purchase';
    if v_bal - v_earned >= v_dpts then
      v_bal := public.apply_member_points(p_member, -v_dpts, 'redeem', p_order, null,
        '$' || to_char(v_off, 'FM999990.00') || ' off' || coalesce(' order #' || v_num, ''), p_by);
      insert into reward_redemptions (member_id, reward_id, name, kind, quantity, points, real_cost, order_id, created_by)
      select p_member, c.id, coalesce(c.name, '$5 off'), 'discount', 1, v_dpts, round(coalesce(c.real_cost, 5) * v_dpts / 100.0, 2), p_order, p_by
        from (select 1) one left join (select * from reward_catalog where kind = 'discount' limit 1) c on true;
      used := used + v_dpts;
      v_discount := true;
    else
      short := short || jsonb_build_object('name', '$5 off', 'points', v_dpts, 'balance', v_bal - v_earned, 'why', 'short');
    end if;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    q := greatest(1, least(20, coalesce((it->>'quantity')::int, 1)));
    select * into r from reward_catalog where id = (it->>'reward_id')::uuid and kind = 'good' for update;
    if not found then
      short := short || jsonb_build_object('reward_id', it->>'reward_id', 'why', 'not_found');
      continue;
    end if;
    pts := r.points * q;
    if r.stock is not null and r.stock < q then
      short := short || jsonb_build_object('reward_id', r.id, 'name', r.name, 'points', pts, 'why', 'stock', 'problem', 'All gone for now.');
      continue;
    end if;
    v_problem := public.reward_limit_problem(p_member, r.id, q, 0, 0);
    if v_problem is not null and v_problem <> 'All gone for now.' then
      short := short || jsonb_build_object('reward_id', r.id, 'name', r.name, 'points', pts, 'why', 'limit', 'problem', v_problem);
      continue;
    end if;
    if v_bal < pts then
      short := short || jsonb_build_object('reward_id', r.id, 'name', r.name, 'points', pts, 'balance', v_bal, 'why', 'short');
      continue;
    end if;
    v_bal := public.apply_member_points(p_member, -pts, 'redeem', p_order, null,
      'Reward: ' || r.name || case when q > 1 then ' ×' || q else '' end || coalesce(' (order #' || v_num || ')', ''), p_by);
    insert into reward_redemptions (member_id, reward_id, name, kind, quantity, points, real_cost, order_id, created_by)
    values (p_member, r.id, r.name, 'good', q, pts, r.real_cost * q, p_order, p_by);
    if r.stock is not null then update reward_catalog set stock = stock - q where id = r.id; end if;
    used := used + pts;
  end loop;

  return jsonb_build_object('status', 'ok', 'used', used, 'balance', v_bal, 'discount_taken', v_discount, 'short', short);
end;
$$;
revoke execute on function public.redeem_order_points(uuid, uuid, jsonb, integer, uuid) from public, anon, authenticated;
grant execute on function public.redeem_order_points(uuid, uuid, jsonb, integer, uuid) to service_role;
