-- Staging for the old Indy register's history (exported Oct 9, 2026):
-- order items, payments, Indy's own points ledger, showings, gift cards,
-- vouchers and the users file, plus two derived tables:
--   indy_user_matches   which member each Indy user is (indy id, else exact
--                       email, else phone; unique matches only)
--   indy_fortis_links   which Fortis sale each Indy card payment is (last
--                       four + brand + amount + time), so a purchase is never
--                       counted from both systems.
--
-- Staging only: nothing here is shown to members, grants points or changes
-- members. scripts/load-indy-history.mjs fills it (truncate and reload, so
-- re-running gives the same result). It holds customer details from the
-- export: server-only, RLS on, no client policies.
--
-- Money is in cents. Indy times are as exported (no zone): paid_at_local.
-- The full exported row is kept in raw.
--
-- Additive and safe to run twice.

create table if not exists public.indy_users (
  id text primary key,
  email_lc text,
  phone_digits text,
  points_preloaded numeric,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);

create table if not exists public.indy_order_items (
  row_no integer primary key,
  order_id text not null,
  user_id text,
  email_lc text,
  state text,
  type text,
  order_state text,
  price_cents integer,
  tax_cents integer,
  discount_cents integer,
  voucher_cents integer,
  paid_at_local timestamp,
  movie_id text,
  sales_channel text,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);
create index if not exists indy_order_items_order_idx on public.indy_order_items (order_id);
create index if not exists indy_order_items_user_idx on public.indy_order_items (user_id);

create table if not exists public.indy_payments (
  id text primary key,
  order_id text,
  type text,
  subtype text,
  state text,
  amount_cents integer,
  paid_at_local timestamp,
  last_four text,
  card_type text,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);
create index if not exists indy_payments_order_idx on public.indy_payments (order_id);

create table if not exists public.indy_user_points (
  id text primary key,
  email_lc text,
  phone_digits text,
  order_id text,
  state text,
  reason text,
  amount_earned numeric,
  amount_used numeric,
  amount_remaining numeric,
  expires_at_local timestamp,
  created_at_local timestamp,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);

create table if not exists public.indy_showings (
  id text primary key,
  time_local timestamp,
  movie_id text,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);

create table if not exists public.indy_gift_cards (
  id text primary key,
  recipient_user_id text,
  state text,
  initial_cents integer,
  balance_cents integer,
  expires_at_local timestamp,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);

create table if not exists public.indy_vouchers (
  id text primary key,
  user_id text,
  email_lc text,
  state text,
  voucher_type_name text,
  raw jsonb not null,
  loaded_at timestamptz not null default now()
);

create table if not exists public.indy_user_matches (
  indy_user_id text primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  match_kind text not null check (match_kind in ('indy_id', 'email', 'phone')),
  matched_at timestamptz not null default now()
);
create index if not exists indy_user_matches_member_idx on public.indy_user_matches (member_id);

create table if not exists public.indy_fortis_links (
  payment_id text primary key references public.indy_payments(id) on delete cascade,
  fortis_sale_id uuid not null unique references public.fortis_sales(id) on delete cascade,
  seconds_apart integer not null,
  linked_at timestamptz not null default now()
);

alter table public.indy_users enable row level security;
alter table public.indy_order_items enable row level security;
alter table public.indy_payments enable row level security;
alter table public.indy_user_points enable row level security;
alter table public.indy_showings enable row level security;
alter table public.indy_gift_cards enable row level security;
alter table public.indy_vouchers enable row level security;
alter table public.indy_user_matches enable row level security;
alter table public.indy_fortis_links enable row level security;

grant select, insert, update, delete on public.indy_users to service_role;
grant select, insert, update, delete on public.indy_order_items to service_role;
grant select, insert, update, delete on public.indy_payments to service_role;
grant select, insert, update, delete on public.indy_user_points to service_role;
grant select, insert, update, delete on public.indy_showings to service_role;
grant select, insert, update, delete on public.indy_gift_cards to service_role;
grant select, insert, update, delete on public.indy_vouchers to service_role;
grant select, insert, update, delete on public.indy_user_matches to service_role;
grant select, insert, update, delete on public.indy_fortis_links to service_role;
