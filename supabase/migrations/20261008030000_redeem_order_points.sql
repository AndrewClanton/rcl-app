-- A sale's points spending, all under the member's lock (code review M9,
-- N12): the $5 off's 100 points and the reward goods on the order, checked
-- and taken in one step, so two registers can't both spend the same points
-- and nothing pushes a balance below zero.
--
-- redeem_order_points(member, order, items, discount_points, by): like
-- redeem_order_rewards (20261007020000_points_rewards.sql, left in place),
-- except:
--   - the $5 off is taken here (p_discount_points: the points it costs),
--     only if the balance covers it, not counting what this same order
--     earned (the register checked it against the balance before the sale);
--     otherwise it's left untaken and listed in 'short';
--   - each good is checked against its limits (per day, per month, and the
--     goods limits: reward_limit_problem, which counts what this call has
--     already redeemed) and its stock, under the lock. A breach is left
--     untaken and listed in 'short' with why ('limit' or 'stock', and the
--     reason), as is one the balance doesn't cover ('short').
-- Returns {status, used, balance, discount_taken, short}. A second call for
-- the same order does nothing ('done').
--
-- Additive: one new function. Nothing is dropped or changed.

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
  v_problem text;
  short jsonb := '[]'::jsonb;
  used integer := 0;
  v_discount boolean := false;
begin
  if p_member is null or p_order is null then return jsonb_build_object('status', 'none'); end if;
  perform 1 from orders where id = p_order for update;
  if exists (select 1 from reward_redemptions where order_id = p_order) then
    return jsonb_build_object('status', 'done');
  end if;
  select points into v_bal from members where id = p_member for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select order_number into v_num from orders where id = p_order;

  -- The $5 off first, against the balance before this sale's own points.
  if coalesce(p_discount_points, 0) > 0 then
    select coalesce(sum(delta), 0) into v_earned from points_ledger
     where order_id = p_order and member_id = p_member and reason = 'purchase';
    if v_bal - v_earned >= p_discount_points then
      v_bal := public.apply_member_points(p_member, -p_discount_points, 'redeem', p_order, null,
        '$5 off' || coalesce(' order #' || v_num, ''), p_by);
      insert into reward_redemptions (member_id, reward_id, name, kind, quantity, points, real_cost, order_id, created_by)
      select p_member, c.id, coalesce(c.name, '$5 off'), 'discount', 1, p_discount_points, coalesce(c.real_cost, 5), p_order, p_by
        from (select 1) one left join (select * from reward_catalog where kind = 'discount' limit 1) c on true;
      used := used + p_discount_points;
      v_discount := true;
    else
      short := short || jsonb_build_object('name', '$5 off', 'points', p_discount_points, 'balance', v_bal - v_earned, 'why', 'short');
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
    -- Limits, counting what this order has redeemed so far (those rows are
    -- already in reward_redemptions). Stock was checked just above.
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
