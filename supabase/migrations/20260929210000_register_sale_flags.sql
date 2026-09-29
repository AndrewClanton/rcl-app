-- Register sales the server wanted a person to look at (lib/register-sale-checks.ts):
--   totals_mismatch  the order's math didn't match the server's own from menu
--                    prices, modifiers, tickets, discounts and tax (saved anyway:
--                    the check is log-only for now)
--   totals_refused   the same, refused (only once enforcing is switched on)
--   card_refused     a card payment Stripe said wasn't real, didn't go through,
--                    wasn't the register's, or was for a different amount
--   card_unchecked   Stripe couldn't be reached to confirm the card payment, so
--                    the sale was saved unchecked (or a tab's card paid another tab)
--   points_short     a points reward was used but the member no longer had the
--                    points, so none were taken off
-- `details` holds what the register sent and what the server figured.
--
-- The app tolerates this being missing (it still writes the server log), so
-- it can be applied any time. Safe to run more than once.

create table if not exists register_sale_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  order_id uuid references orders(id) on delete set null,
  order_number bigint,
  employee_id uuid references employees(id) on delete set null,
  stripe_payment_intent_id text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists register_sale_flags_created_idx on register_sale_flags (created_at desc);
create index if not exists register_sale_flags_kind_idx on register_sale_flags (kind, created_at desc);

-- Server-only, like the rest: RLS on, no client policies.
alter table register_sale_flags enable row level security;
