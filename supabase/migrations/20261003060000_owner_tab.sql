-- The owner rate and the monthly owner tab (Andrew, 10/3): the owners can
-- have anything on the menu at what it cost the business, so enjoying the
-- place doesn't dig into the bottom line invisibly. Rung up as usual on the
-- register; the owner sees the order and its total and types their own
-- PIN; the order goes on that owner's tab for the month instead of being
-- paid. Once a month each owner settles their statement in one payment,
-- recorded in Back office -> Owner tab.
--
--   employees.owner_rate       who gets it: a tick on the person, not a role.
--                              Nobody is ticked to start with: an owner ticks
--                              Andrew, Nathan and Caleb on the Owner tab page.
--   owner_rate_changes         every change to that tick: who, when, on or off.
--   recipes.cost_complete      "Recipe cost is complete", ticked on Menu ->
--                              Recipe by a manager. An item is at cost only
--                              with this ticked and every ingredient costed;
--                              anything else is half price. Nothing is
--                              ticked to start with (owners pay more, never
--                              less), and changing a recipe's ingredients
--                              unticks it.
--   orders.payment_method      'owner_tab': no cash, no card, nothing taken.
--   orders.owner_tab_employee_id  whose tab it's on.
--   orders.owner_menu_value    what the order would have come to at menu
--                              prices, before tax. Reports show both.
--   orders.owner_rate_nonce    the owner's PIN approval it used: one
--                              approval, one order.
--   orders.owner_tab_removed_*    an owner-tab order taken off the tab:
--                              which other owner's PIN, why, and when.
--   order_items.menu_unit_price, owner_pricing
--                              each owner-tab line's menu price and how it
--                              was priced: 'cost', 'half' (no complete cost
--                              on file: half the menu price), 'menu' (a
--                              ticket or custom item, at its normal price).
--   owner_tab_payments         a payment against one month's statement, by
--                              whom and how, with the sales tax inside it.
--                              Part payments add up.
--   record_owner_tab_payment() records one, never more than is left on the
--                              month (the owner's row is locked meanwhile,
--                              so two at once can't both fit).
--
-- The register re-prices every owner order on the server from the recipes
-- (lib/owner-rate-server.ts), and the checks below keep an owner-tab order
-- from ever carrying a card or cash payment.
--
-- Staff-only data: RLS on, no client policies; the server reads and writes
-- with the service role. Safe to run more than once. The check constraints
-- go on NOT VALID and are validated after, so the tables aren't locked
-- against writes while existing rows are checked.

alter table employees add column if not exists owner_rate boolean not null default false;

create table if not exists owner_rate_changes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  turned_on boolean not null,
  changed_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_rate_changes_created_at_idx on owner_rate_changes(created_at);
alter table owner_rate_changes enable row level security;

alter table recipes add column if not exists cost_complete boolean not null default false;

alter table orders add column if not exists owner_tab_employee_id uuid references employees(id);
alter table orders add column if not exists owner_menu_value numeric(10,2);
alter table orders add column if not exists owner_rate_nonce uuid;
alter table orders add column if not exists owner_tab_removed_by uuid references employees(id) on delete set null;
alter table orders add column if not exists owner_tab_removed_reason text;
alter table orders add column if not exists owner_tab_removed_at timestamptz;

alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check check (payment_method in ('cash', 'card', 'split', 'voucher', 'owner_tab')) not valid;
alter table orders validate constraint orders_payment_method_check;

-- An owner-tab order names its owner and takes no money; nothing else
-- names an owner.
alter table orders drop constraint if exists orders_owner_tab_check;
alter table orders add constraint orders_owner_tab_check check (
  case
    when payment_method = 'owner_tab' then
      owner_tab_employee_id is not null
      and stripe_payment_intent_id is null
      and coalesce(payment_card_amount, 0) = 0
      and coalesce(payment_cash_amount, 0) = 0
      and coalesce(payment_voucher_amount, 0) = 0
      and tip = 0
    else owner_tab_employee_id is null
  end
) not valid;
alter table orders validate constraint orders_owner_tab_check;

create unique index if not exists orders_owner_rate_nonce_idx on orders(owner_rate_nonce) where owner_rate_nonce is not null;
create index if not exists orders_owner_tab_idx on orders(owner_tab_employee_id, completed_at) where owner_tab_employee_id is not null;

alter table order_items add column if not exists menu_unit_price numeric(10,2);
alter table order_items add column if not exists owner_pricing text;
alter table order_items drop constraint if exists order_items_owner_pricing_check;
alter table order_items add constraint order_items_owner_pricing_check check (owner_pricing is null or owner_pricing in ('cost', 'half', 'menu')) not valid;
alter table order_items validate constraint order_items_owner_pricing_check;

create table if not exists owner_tab_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references employees(id),
  -- The statement it pays: a business month, "2026-10".
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('card', 'cash', 'check', 'transfer')),
  -- The date on the payment (a check's date, say). Reports count it as
  -- money in on the day it was recorded (created_at).
  paid_on date not null,
  note text,
  recorded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
-- The sales tax inside the payment: the month's tax in proportion, for
-- Reports' "Of it, sales tax".
alter table owner_tab_payments add column if not exists tax_amount numeric(10,2) not null default 0;
create index if not exists owner_tab_payments_owner_month_idx on owner_tab_payments(owner_id, month);
create index if not exists owner_tab_payments_created_at_idx on owner_tab_payments(created_at);

alter table owner_tab_payments enable row level security;

-- One payment against one owner's month, never more than is left on it.
-- The owner's employees row is locked for the rest of the transaction, so
-- two payments recorded at the same moment take turns. A business month
-- runs 4 a.m. Central on the 1st to 4 a.m. on the next 1st, worked out the
-- way the app's businessDay() does (4 hours back, then the Central date).
-- Returns { id, owed, paid, balance }; id is null when it didn't fit.
create or replace function public.record_owner_tab_payment(
  p_owner uuid,
  p_month text,
  p_amount numeric,
  p_method text,
  p_paid_on date,
  p_note text,
  p_by uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_owed numeric(10,2);
  v_tax numeric(10,2);
  v_paid numeric(10,2);
  v_id uuid;
begin
  perform 1 from employees where id = p_owner for update;
  if not found then
    return jsonb_build_object('id', null, 'owed', 0, 'paid', 0, 'balance', 0);
  end if;
  select coalesce(sum(total), 0), coalesce(sum(tax), 0) into v_owed, v_tax
    from orders
    where payment_method = 'owner_tab'
      and status = 'completed'
      and owner_tab_employee_id = p_owner
      and to_char((completed_at - interval '4 hours') at time zone 'America/Chicago', 'YYYY-MM') = p_month;
  select coalesce(sum(amount), 0) into v_paid from owner_tab_payments where owner_id = p_owner and month = p_month;
  if p_amount is null or p_amount <= 0 or p_amount > v_owed - v_paid then
    return jsonb_build_object('id', null, 'owed', v_owed, 'paid', v_paid, 'balance', v_owed - v_paid);
  end if;
  insert into owner_tab_payments (owner_id, month, amount, tax_amount, method, paid_on, note, recorded_by)
  values (p_owner, p_month, p_amount, case when v_owed > 0 then round(p_amount * v_tax / v_owed, 2) else 0 end, p_method, p_paid_on, p_note, p_by)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'owed', v_owed, 'paid', v_paid + p_amount, 'balance', v_owed - v_paid - p_amount);
end
$$;

-- New since Oct 30, 2026: granted here (supabase/README.md). The app only
-- reads and adds payments and tick changes; it never changes or deletes one.
grant select, insert on table owner_tab_payments to service_role;
grant select, insert on table owner_rate_changes to service_role;
revoke execute on function public.record_owner_tab_payment(uuid, text, numeric, text, date, text, uuid) from public, anon, authenticated;
grant execute on function public.record_owner_tab_payment(uuid, text, numeric, text, date, text, uuid) to service_role;
