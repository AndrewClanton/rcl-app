-- Order from your seat (Andrew, 10/7): guests scan the QR card at a booth,
-- in the cinema, on the patio or at a table, order on their phone and pay
-- there (Stripe). A paid order is a normal order (source 'mobile'), so
-- Reports, points, tax and stock count it like any other.
--
-- order_spots: the places a QR card can sit. `code` is the random part of
--   the card's link (/order/<code>); rotating it kills a copied card.
--   `dark`: the phone menu goes dim (the cinema).
-- seat_ordering_settings: one row. The on/off switch (Back office and the
--   register's Staff panel) and the hours it's on. Sundays are always off
--   (src/lib/closed-days.ts).
-- seat_checkouts: a phone's cart while it pays: the priced lines and
--   totals, and the Stripe payment. Once paid it points at its order. The
--   guest's status page is found by its id.
-- orders: which spot, the delivery note, the "ID check on delivery" flag
--   and where it's at (new, making, delivered). The boards read these
--   through the existing staff policy and Realtime on orders.
--
-- Server-only like the other tables: RLS on, no client policies. Safe to
-- run twice.

create table if not exists public.order_spots (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('booth', 'cinema', 'patio', 'table')),
  name text not null check (length(name) between 1 and 40),
  code text not null unique check (code ~ '^[a-z0-9]{8,16}$'),
  dark boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  code_rotated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists order_spots_name_idx on public.order_spots (lower(name));
alter table public.order_spots enable row level security;
grant select, insert, update, delete on public.order_spots to service_role;

create table if not exists public.seat_ordering_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  opens text not null default '16:00' check (opens ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closes text not null default '23:30' check (closes ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null
);
insert into public.seat_ordering_settings (id) values (1) on conflict (id) do nothing;
alter table public.seat_ordering_settings enable row level security;
grant select, insert, update on public.seat_ordering_settings to service_role;

create table if not exists public.seat_checkouts (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.order_spots(id) on delete cascade,
  spot_name text not null,
  stripe_payment_intent_id text unique,
  member_id uuid references public.members(id) on delete set null,
  guest_name text check (guest_name is null or length(guest_name) <= 40),
  note text check (note is null or length(note) <= 200),
  lines jsonb not null,
  totals jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists seat_checkouts_created_idx on public.seat_checkouts (created_at);
alter table public.seat_checkouts enable row level security;
grant select, insert, update, delete on public.seat_checkouts to service_role;

-- Orders from a phone.
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('pos', 'web', 'mobile'));
alter table public.orders add column if not exists spot_id uuid references public.order_spots(id) on delete set null;
alter table public.orders add column if not exists spot_name text;
alter table public.orders add column if not exists seat_note text;
alter table public.orders add column if not exists id_check boolean not null default false;
alter table public.orders add column if not exists seat_status text;
alter table public.orders add column if not exists seat_making_at timestamptz;
alter table public.orders add column if not exists seat_delivered_at timestamptz;
alter table public.orders drop constraint if exists orders_seat_status_check;
alter table public.orders add constraint orders_seat_status_check check (seat_status is null or seat_status in ('new', 'making', 'delivered'));
-- One order per phone payment: the phone and the Stripe webhook can both
-- finish the same checkout at once (lib/seat-ordering-server.ts).
create unique index if not exists orders_seat_payment_once on public.orders (stripe_payment_intent_id) where source = 'mobile' and stripe_payment_intent_id is not null;
create index if not exists orders_seat_open_idx on public.orders (created_at) where seat_status in ('new', 'making');

-- The starting spots: Booth 1-8, the cinema by row, the patio and four
-- tables. Rename, add or switch them off in Back office.
insert into public.order_spots (kind, name, code, dark, sort_order)
select v.kind, v.name, substr(md5(gen_random_uuid()::text), 1, 10), v.dark, v.sort_order
from (
  values
    ('booth', 'Booth 1', false, 1), ('booth', 'Booth 2', false, 2), ('booth', 'Booth 3', false, 3), ('booth', 'Booth 4', false, 4),
    ('booth', 'Booth 5', false, 5), ('booth', 'Booth 6', false, 6), ('booth', 'Booth 7', false, 7), ('booth', 'Booth 8', false, 8),
    ('cinema', 'Cinema · Row A', true, 20), ('cinema', 'Cinema · Row B', true, 21), ('cinema', 'Cinema · Row C', true, 22),
    ('cinema', 'Cinema · Row D', true, 23), ('cinema', 'Cinema · Row E', true, 24),
    ('patio', 'Patio', false, 40),
    ('table', 'Table 1', false, 60), ('table', 'Table 2', false, 61), ('table', 'Table 3', false, 62), ('table', 'Table 4', false, 63)
) as v(kind, name, dark, sort_order)
where not exists (select 1 from public.order_spots);
