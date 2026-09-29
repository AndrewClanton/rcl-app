-- Partial refunds on register and web orders (code review B2): part of an
-- order given back (a wrong drink, a dish sent back) without refunding the
-- whole thing. A full refund is unchanged: it flips orders.status to
-- 'refunded' and adds no row here.
--
-- One row per partial refund, written by the server only (Reports,
-- "Refund part", src/app/admin/reports/actions.ts), after a manager PIN
-- and, for a card sale, after Stripe has refunded that amount.
--   amount       what the customer got back, sales tax included
--   tax_amount   the sales tax inside amount (the order's tax, in proportion),
--                which the sales tax report takes back off
--   card_amount  the part that went back to the card: through Stripe
--                (stripe_refund_id) when the sale was paid on the
--                register's reader or the website, otherwise by hand on
--                the card machine it was run on
--   cash_amount  the part handed back from the drawer
-- Reports take partial refunds off the business day the order was sold.
--
-- Until this is applied, "Refund part" says so and refunds nothing; full
-- refunds and every report keep working. Additive and safe to run twice.

create table if not exists order_partial_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  amount numeric(10,2) not null check (amount > 0),
  tax_amount numeric(10,2) not null default 0 check (tax_amount >= 0),
  card_amount numeric(10,2) not null default 0 check (card_amount >= 0),
  cash_amount numeric(10,2) not null default 0 check (cash_amount >= 0),
  stripe_refund_id text unique,
  reason text,
  approved_by uuid references employees(id) on delete set null, -- whose manager PIN approved it (null: shared PIN)
  refunded_by uuid references employees(id) on delete set null, -- who was signed in
  created_at timestamptz not null default now(),
  constraint order_partial_refunds_split check (card_amount + cash_amount = amount)
);

create index if not exists order_partial_refunds_order_idx on order_partial_refunds(order_id);

-- Server-only, like the rest: RLS on, no client policies.
alter table order_partial_refunds enable row level security;
