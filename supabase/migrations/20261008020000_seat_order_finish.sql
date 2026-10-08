-- Seat orders: the order and its items saved together, and a retry that
-- finishes what a crash left undone (code review N9, N23).
--
-- finish_seat_order(checkout, order, items): in one transaction, the paid
-- checkout's order (one per payment, voided or not, the same rule as the
-- orders_seat_payment_once index) with all its items, and the checkout
-- marked paid and linked to it. Called by lib/seat-ordering-server.ts
-- finishSeatCheckout with the service role.
--   p_order: the orders columns the app sets (no order_number: it's taken
--     here, so a lost race doesn't use one up).
--   p_items: [{menu_item_id, name, unit_price, quantity, modifiers, is_alcohol}]
-- Returns the order's id and number, and created = false when the payment
-- already had its order (made by the phone, the webhook or the sweep).
--
-- seat_checkouts.fulfilled_at: set once the order's points and kitchen
-- ticket are done. A finish that finds the order made but this empty does
-- them (fulfil_claimed_at stops two callers doing them at once, and lets a
-- retry take over after 2 minutes if the first one died).
--
-- Additive: two columns and a function. Nothing is dropped.

alter table public.seat_checkouts add column if not exists fulfilled_at timestamptz;
alter table public.seat_checkouts add column if not exists fulfil_claimed_at timestamptz;

-- Checkouts already paid before this: their points and tickets were done.
update public.seat_checkouts set fulfilled_at = coalesce(paid_at, now()) where status = 'paid' and fulfilled_at is null;

create or replace function public.finish_seat_order(p_checkout uuid, p_order jsonb, p_items jsonb)
returns table (order_id uuid, order_number bigint, created boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pi text := p_order->>'stripe_payment_intent_id';
  v_member uuid := nullif(p_order->>'member_id', '')::uuid;
  v_perk date := nullif(p_order->>'daily_perk_date', '')::date;
  -- When the card was charged (Stripe's time), so an order the sweep
  -- finishes later still lands on the night it was paid. Never later than
  -- now, never more than 3 days back.
  v_at timestamptz := greatest(least(coalesce(nullif(p_order->>'completed_at', '')::timestamptz, now()), now()), now() - interval '3 days');
  v_id uuid;
  v_num bigint;
  v_constraint text;
begin
  if v_pi is null or v_pi = '' then
    raise exception 'finish_seat_order: no payment';
  end if;

  -- One finish at a time per checkout.
  perform 1 from seat_checkouts where id = p_checkout for update;
  if not found then
    raise exception 'finish_seat_order: checkout % not found', p_checkout;
  end if;

  -- The payment's order, whatever its status (a voided one counts, as in
  -- orders_seat_payment_once).
  select o.id, o.order_number into v_id, v_num
    from orders o
   where o.stripe_payment_intent_id = v_pi and o.source = 'mobile'
   limit 1;
  if v_id is not null then
    update seat_checkouts set status = 'paid', order_id = v_id, paid_at = coalesce(paid_at, now()) where id = p_checkout;
    return query select v_id, v_num, false;
    return;
  end if;

  -- The daily coffee counts as today's only while it's unused.
  if v_perk is not null and v_member is not null and exists (
    select 1 from orders o where o.member_id = v_member and o.daily_perk_date = v_perk and o.status = 'completed'
  ) then
    v_perk := null;
  end if;

  v_num := next_order_number();
  begin
    insert into orders (
      order_number, source, status, employee_id, member_id, order_name,
      subtotal, tier_discount, monthly_discount, redemption_discount, tax_free, monthly_member,
      tax, tip, total, payment_method, payment_cash_amount, payment_voucher_amount, payment_card_amount,
      stripe_payment_intent_id, points_redeemed, age_verified, completed_at, created_at,
      spot_id, spot_name, seat_note, id_check, seat_status, daily_perk_discount, daily_perk_date
    ) values (
      v_num, 'mobile', 'completed', null, v_member, p_order->>'order_name',
      (p_order->>'subtotal')::numeric, coalesce((p_order->>'tier_discount')::numeric, 0), 0, 0, false, false,
      (p_order->>'tax')::numeric, coalesce((p_order->>'tip')::numeric, 0), (p_order->>'total')::numeric,
      'card', 0, 0, (p_order->>'total')::numeric,
      v_pi, false, false, v_at, v_at,
      nullif(p_order->>'spot_id', '')::uuid, p_order->>'spot_name', p_order->>'seat_note',
      coalesce((p_order->>'id_check')::boolean, false), 'new',
      coalesce((p_order->>'daily_perk_discount')::numeric, 0), v_perk
    )
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'orders_daily_perk_once' then
      -- Used by another order a moment ago: they've paid either way.
      insert into orders (
        order_number, source, status, employee_id, member_id, order_name,
        subtotal, tier_discount, monthly_discount, redemption_discount, tax_free, monthly_member,
        tax, tip, total, payment_method, payment_cash_amount, payment_voucher_amount, payment_card_amount,
        stripe_payment_intent_id, points_redeemed, age_verified, completed_at, created_at,
        spot_id, spot_name, seat_note, id_check, seat_status, daily_perk_discount, daily_perk_date
      ) values (
        v_num, 'mobile', 'completed', null, v_member, p_order->>'order_name',
        (p_order->>'subtotal')::numeric, coalesce((p_order->>'tier_discount')::numeric, 0), 0, 0, false, false,
        (p_order->>'tax')::numeric, coalesce((p_order->>'tip')::numeric, 0), (p_order->>'total')::numeric,
        'card', 0, 0, (p_order->>'total')::numeric,
        v_pi, false, false, v_at, v_at,
        nullif(p_order->>'spot_id', '')::uuid, p_order->>'spot_name', p_order->>'seat_note',
        coalesce((p_order->>'id_check')::boolean, false), 'new',
        coalesce((p_order->>'daily_perk_discount')::numeric, 0), null
      )
      returning id into v_id;
    else
      raise;
    end if;
  end;

  insert into order_items (order_id, menu_item_id, name, unit_price, quantity, modifiers, is_alcohol, is_event)
  select v_id, x.menu_item_id, x.name, x.unit_price, x.quantity, coalesce(x.modifiers, '[]'::jsonb), coalesce(x.is_alcohol, false), false
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(menu_item_id uuid, name text, unit_price numeric, quantity integer, modifiers jsonb, is_alcohol boolean);

  update seat_checkouts set status = 'paid', order_id = v_id, paid_at = now() where id = p_checkout;
  return query select v_id, v_num, true;
end;
$$;

revoke all on function public.finish_seat_order(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finish_seat_order(uuid, jsonb, jsonb) to service_role;
