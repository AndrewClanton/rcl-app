-- The owner rate and the monthly owner tab (Andrew, 10/3): the owners can
-- have anything on the menu at what it cost the business, so enjoying the
-- place doesn't dig into the bottom line invisibly. Rung up as usual on the
-- register; the owner types their own PIN; the order goes on that owner's
-- tab for the month instead of being paid. Once a month each owner settles
-- their statement in one payment, recorded in Back office -> Owner tab.
--
--   employees.owner_rate       who gets it: a tick on the person, not a role
--                              (Mary is an owner too and isn't included).
--                              Nobody is ticked to start with: an owner ticks
--                              Andrew, Nathan and Caleb on the Owner tab page.
--   orders.payment_method      'owner_tab': no cash, no card, nothing taken.
--   orders.owner_tab_employee_id  whose tab it's on.
--   orders.owner_menu_value    what the order would have come to at menu
--                              prices, before tax (the owner rate saved the
--                              difference). Reports show both.
--   orders.owner_rate_nonce    the owner's PIN approval it used: one
--                              approval, one order.
--   order_items.menu_unit_price, owner_pricing
--                              each owner-tab line's menu price and how it
--                              was priced: 'cost' (its recipe, every
--                              ingredient costed), 'half' (no cost on file:
--                              half the menu price), 'menu' (a ticket or
--                              custom item, at its normal price).
--   owner_tab_payments         a payment against one month's statement, by
--                              whom and how. Part payments add up.
--
-- The register re-prices every owner order on the server from the recipes
-- (lib/owner-rate-server.ts), and the checks below keep an owner-tab order
-- from ever carrying a card or cash payment.
--
-- Staff-only data: RLS on, no client policies; the server reads and writes
-- with the service role. Safe to run more than once.

alter table employees add column if not exists owner_rate boolean not null default false;

alter table orders add column if not exists owner_tab_employee_id uuid references employees(id);
alter table orders add column if not exists owner_menu_value numeric(10,2);
alter table orders add column if not exists owner_rate_nonce uuid;

alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check check (payment_method in ('cash', 'card', 'split', 'voucher', 'owner_tab'));

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
);

create unique index if not exists orders_owner_rate_nonce_idx on orders(owner_rate_nonce) where owner_rate_nonce is not null;
create index if not exists orders_owner_tab_idx on orders(owner_tab_employee_id, completed_at) where owner_tab_employee_id is not null;

alter table order_items add column if not exists menu_unit_price numeric(10,2);
alter table order_items add column if not exists owner_pricing text;
alter table order_items drop constraint if exists order_items_owner_pricing_check;
alter table order_items add constraint order_items_owner_pricing_check check (owner_pricing is null or owner_pricing in ('cost', 'half', 'menu'));

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
create index if not exists owner_tab_payments_owner_month_idx on owner_tab_payments(owner_id, month);
create index if not exists owner_tab_payments_created_at_idx on owner_tab_payments(created_at);

alter table owner_tab_payments enable row level security;

-- New since Oct 30, 2026: granted here (supabase/README.md). The app only
-- reads and adds payments; a mistake is put right with a note, not deleted.
grant select, insert on table owner_tab_payments to service_role;
