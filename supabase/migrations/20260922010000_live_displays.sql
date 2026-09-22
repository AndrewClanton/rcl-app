-- Live kitchen/bar/customer displays: prep tickets that staff can mark
-- ready, and a customer-facing kiosk that mirrors the order being built.

-- Per-item prep status -- lets kitchen/bar staff mark a ticket item ready
-- without touching the order's own status (payment/fulfillment stay
-- separate from "has this actually been made yet").
alter table order_items add column ready boolean not null default false;
alter table order_items add column ready_at timestamptz;

-- Member profile pictures, shown on the customer-facing kiosk after
-- phone-number lookup. Admin-moderatable (see /admin/members).
alter table members add column avatar_url text;

-- Which order the customer-facing kiosk should mirror right now. One row
-- per physical register -- only 'main' is used today, but keying by
-- register_key means a second register/kiosk pair doesn't need a
-- redesign, just a new row. Real-time-readable the same way orders/
-- order_items already are (authenticated role, all writes via
-- service-role actions).
create table register_state (
  register_key text primary key,
  active_order_id uuid references orders(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into register_state (register_key) values ('main');

alter table register_state enable row level security;
create policy "authenticated read register_state" on register_state for select to authenticated using (true);
