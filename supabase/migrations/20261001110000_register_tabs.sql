-- Tabs and held orders: all-or-nothing saves, cancelled tabs kept on file,
-- and the voucher number on a voucher sale.
--
-- APPLY THIS BEFORE THE CODE THAT USES IT DEPLOYS (branch
-- loose/register-tabs). The register saves every tab through
-- replace_draft_order, saves a paid sale's items through sync_order_items,
-- cancels a tab by setting status 'cancelled', and writes
-- payment_voucher_code on every sale. Without this, tab saves and
-- cancels fail and every sale's save fails on the unknown column.
-- Additive and safe to run more than once.
--
-- 1. Cancelled tabs. Cancelling a tab (manager PIN) used to delete it. Now
--    it stays, with its items, as status 'cancelled': when, who was on the
--    register, and whose PIN approved it. A cancelled tab was never paid:
--    it isn't a sale, and every report, points and seat count leaves it
--    out (they all pick 'completed', or 'completed'/'refunded'/'voided',
--    by name). It never has a card payment on it, so the
--    one-order-per-card-payment index is unaffected.
-- 2. payment_voucher_code: the number printed on the paper voucher(s) a
--    sale was paid with, when the cashier typed it (optional).
-- 3. sync_order_items / replace_draft_order: a tab or held order's header
--    and items saved in one transaction. The items are matched by id, so a
--    line that didn't change keeps its row (and the kitchen and bar
--    boards' ready mark); a changed line is updated; a new line is added;
--    a line taken off is deleted. Before, every save inserted every line
--    again and deleted the old rows, which reset 'ready' and, if a step
--    failed, left the total ahead of the items or the items doubled.

-- ---------- cancelled tabs ----------

alter table orders add column if not exists cancelled_at timestamptz;
alter table orders add column if not exists cancelled_by uuid references employees(id) on delete set null; -- the cashier on the register
alter table orders add column if not exists cancel_approved_by uuid references employees(id) on delete set null; -- whose manager PIN (null: shared PIN)

-- The initial schema's inline check is named orders_status_check.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('draft', 'held', 'tab', 'completed', 'refunded', 'voided', 'cancelled'));

create index if not exists orders_cancelled_at_idx on orders (cancelled_at) where status = 'cancelled';

-- ---------- voucher number ----------

alter table orders add column if not exists payment_voucher_code text;

-- ---------- tab and held-order saves ----------

-- Makes an order's items exactly p_items, a JSON array of
-- {id?, menu_item_id, name, unit_price, quantity, modifiers, is_alcohol,
-- screening_id}, and returns the row id of each line, in the same order.
-- A line whose id is one of this order's rows keeps that row; any other
-- line (no id, or an id from somewhere else) is added. Rows the list
-- doesn't name are deleted. One call is one transaction: it all lands or
-- none of it does.
--
-- An existing line is only written when something about it changed, so an
-- untouched line keeps its row and its ready mark. More of it, or a
-- different item, name or options, is something new to make, so it goes
-- back to not ready; fewer of it, or a new price, keeps the mark.
create or replace function public.sync_order_items(p_order uuid, p_items jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  uuid_shape constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  items jsonb := coalesce(p_items, '[]'::jsonb);
  v_keep uuid[];
  v_ids uuid[] := '{}';
  v_line jsonb;
  v_id uuid;
  v_menu uuid;
  v_name text;
  v_price numeric;
  v_qty int;
  v_mods jsonb;
  v_alcohol boolean;
  v_screening uuid;
begin
  if jsonb_typeof(items) <> 'array' then
    raise exception 'sync_order_items: p_items must be a JSON array';
  end if;

  -- One save of an order at a time (a tab save and its payment, say).
  perform 1 from orders where id = p_order for update;

  -- This order's rows that the list still names.
  select coalesce(array_agg(oi.id), '{}') into v_keep
    from order_items oi
   where oi.order_id = p_order
     and oi.id in (
       select case when l.value->>'id' ~ uuid_shape then (l.value->>'id')::uuid end
         from jsonb_array_elements(items) as l(value)
     );

  -- Lines taken off the order.
  delete from order_items where order_id = p_order and not (id = any(v_keep));

  for v_line in select l.value from jsonb_array_elements(items) with ordinality as l(value, n) order by l.n
  loop
    v_id := case when v_line->>'id' ~ uuid_shape then (v_line->>'id')::uuid end;
    v_menu := nullif(v_line->>'menu_item_id', '')::uuid;
    v_name := v_line->>'name';
    v_price := round((v_line->>'unit_price')::numeric, 2);
    v_qty := (v_line->>'quantity')::int;
    v_mods := coalesce(v_line->'modifiers', '[]'::jsonb);
    v_alcohol := coalesce((v_line->>'is_alcohol')::boolean, false);
    v_screening := nullif(v_line->>'screening_id', '')::uuid;

    if v_id is not null and v_id = any(v_keep) and not (v_id = any(v_ids)) then
      update order_items
         set ready = case when v_qty > quantity or v_name is distinct from name or v_mods is distinct from modifiers or v_menu is distinct from menu_item_id
                          then false else ready end,
             ready_at = case when v_qty > quantity or v_name is distinct from name or v_mods is distinct from modifiers or v_menu is distinct from menu_item_id
                             then null else ready_at end,
             menu_item_id = v_menu,
             name = v_name,
             unit_price = v_price,
             quantity = v_qty,
             modifiers = v_mods,
             is_alcohol = v_alcohol,
             screening_id = v_screening,
             -- Tickets aren't made by the kitchen or bar, so they stay off the prep screens.
             is_event = v_screening is not null
       where id = v_id
         and (menu_item_id, name, unit_price, quantity, modifiers, is_alcohol, screening_id)
             is distinct from (v_menu, v_name, v_price, v_qty, v_mods, v_alcohol, v_screening);
    else
      -- clock_timestamp, not now(): lines added in one save keep the order
      -- they were rung in (the register reads them back by created_at).
      insert into order_items (order_id, menu_item_id, name, unit_price, quantity, modifiers, is_alcohol, screening_id, is_event, created_at)
      values (p_order, v_menu, v_name, v_price, v_qty, v_mods, v_alcohol, v_screening, v_screening is not null, clock_timestamp())
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  return v_ids;
end;
$$;

-- Saves a held order or open tab: the header fields in p_fields (only the
-- keys given are changed) and its items (sync_order_items; null leaves
-- them alone), together. Refuses an order that isn't open anymore (paid or
-- cancelled, usually on the other register) with {ok: false, closed:
-- true}, so an out-of-date register can never rewrite a sale. On success:
-- {ok: true, status, order_number, item_ids}.
--
-- A blank cashier keeps whoever was on it. An ID check, once recorded,
-- stays recorded.
create or replace function public.replace_draft_order(p_order uuid, p_fields jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_status text;
  v_number bigint;
  v_ids uuid[];
begin
  select status, order_number into v_status, v_number from orders where id = p_order for update;
  if not found or v_status not in ('draft', 'held', 'tab') then
    return jsonb_build_object('ok', false, 'closed', true);
  end if;

  update orders
     set employee_id = coalesce(nullif(f->>'employee_id', '')::uuid, employee_id),
         member_id = case when f ? 'member_id' then nullif(f->>'member_id', '')::uuid else member_id end,
         order_name = case when f ? 'order_name' then nullif(f->>'order_name', '') else order_name end,
         tab_name = case when f ? 'tab_name' then nullif(f->>'tab_name', '') else tab_name end,
         tax_free = coalesce((f->>'tax_free')::boolean, tax_free),
         monthly_member = coalesce((f->>'monthly_member')::boolean, monthly_member),
         points_redeemed = coalesce((f->>'points_redeemed')::boolean, points_redeemed),
         age_verified = age_verified or coalesce((f->>'age_verified')::boolean, false),
         subtotal = coalesce((f->>'subtotal')::numeric, subtotal),
         tier_discount = coalesce((f->>'tier_discount')::numeric, tier_discount),
         monthly_discount = coalesce((f->>'monthly_discount')::numeric, monthly_discount),
         redemption_discount = coalesce((f->>'redemption_discount')::numeric, redemption_discount),
         tax = coalesce((f->>'tax')::numeric, tax),
         total = coalesce((f->>'total')::numeric, total)
   where id = p_order;

  if p_items is not null then
    v_ids := public.sync_order_items(p_order, p_items);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status, 'order_number', v_number, 'item_ids', to_jsonb(v_ids));
end;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.sync_order_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_order_items(uuid, jsonb) to service_role;
revoke execute on function public.replace_draft_order(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_draft_order(uuid, jsonb, jsonb) to service_role;

-- The API sees the new functions and columns straight away.
notify pgrst, 'reload schema';
