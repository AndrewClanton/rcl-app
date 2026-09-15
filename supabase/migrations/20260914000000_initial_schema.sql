-- Royale Cinema Lounge — initial schema
-- Ported from rcl-pos.html (the working POS prototype), which is the source
-- of truth for the business rules encoded here (discount tiers, event
-- pricing, order lifecycle, etc). Seat maps are intentionally out of scope
-- for v1 — screenings/bookings are general-admission (quantity, no assigned
-- seats) per product decision.

create extension if not exists "pgcrypto";

-- ---------- settings (tunable business rules, editable by admins) ----------
create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('tax_rate', '0.08'),
  ('points_redeem_cost', '100'),
  ('points_redeem_value', '5'),
  ('member_discount_insiders', '0.05'),
  ('member_discount_insiders_plus', '0.10'),
  ('monthly_member_discount', '0.10'),
  ('scheduling_email', '"scheduling@royalecinemajoplin.com"'),
  ('next_order_number', '7841');

-- ---------- rooms (screening rooms & rentable event spaces) ----------
create table rooms (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  capacity int not null check (capacity > 0),
  is_screening_room boolean not null default false,
  is_event_space boolean not null default false,
  hourly_rate numeric(10,2),
  cleaning_fee numeric(10,2),
  created_at timestamptz not null default now()
);

create table room_addons (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  hourly_rate numeric(10,2) not null default 0,
  sort_order int not null default 0
);

-- ---------- movies (TMDb-sourced + local notes) ----------
create table movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id int unique,
  title text not null,
  synopsis text,
  poster_path text,
  runtime_minutes int,
  rating text,
  local_notes text,
  created_at timestamptz not null default now()
);

-- ---------- employees (POS PIN login + optional back-office web login) ----------
create table employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  pin_hash text not null,
  role text not null default 'cashier' check (role in ('cashier', 'manager', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index employees_auth_user_id_idx on employees(auth_user_id) where auth_user_id is not null;

-- ---------- members (loyalty / tiers, optional self-service account) ----------
create table members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  tier text not null default 'Insiders' check (tier in ('Insiders', 'Insiders+')),
  points numeric(10,2) not null default 0,
  monthly_member boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index members_auth_user_id_idx on members(auth_user_id) where auth_user_id is not null;

-- ---------- screenings ----------
create table screenings (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references movies(id) on delete cascade,
  room_id uuid not null references rooms(id),
  starts_at timestamptz not null,
  ticket_price numeric(10,2) not null,
  capacity int not null check (capacity > 0),
  attendance_reported boolean not null default false,
  attendance_count int,
  box_office_revenue numeric(10,2),
  created_at timestamptz not null default now()
);

create index screenings_starts_at_idx on screenings(starts_at);

-- ---------- menu (categories -> items -> modifier groups -> options) ----------
create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  -- non-null parent_id makes this a subcategory (e.g. Beer / Wine / Cocktails under Alcohol)
  parent_id uuid references menu_categories(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references menu_categories(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  is_alcohol boolean not null default false,
  is_event_item boolean not null default false,
  event_price_mode text check (event_price_mode in ('deposit', 'full')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table menu_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references menu_items(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null check (type in ('single', 'multi')),
  sort_order int not null default 0
);

create table menu_modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references menu_modifier_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0,
  sort_order int not null default 0
);

-- ---------- orders (also represents held orders & open tabs via `status`) ----------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null,
  source text not null check (source in ('pos', 'web')),
  status text not null default 'draft'
    check (status in ('draft', 'held', 'tab', 'completed', 'refunded', 'voided')),
  employee_id uuid references employees(id),
  member_id uuid references members(id),
  order_name text,
  tab_name text,
  subtotal numeric(10,2) not null default 0,
  tier_discount numeric(10,2) not null default 0,
  monthly_discount numeric(10,2) not null default 0,
  redemption_discount numeric(10,2) not null default 0,
  tax_free boolean not null default false,
  tax numeric(10,2) not null default 0,
  tip numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  payment_method text check (payment_method in ('cash', 'card', 'split')),
  payment_cash_amount numeric(10,2),
  payment_card_amount numeric(10,2),
  stripe_payment_intent_id text,
  points_redeemed boolean not null default false,
  age_verified boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index orders_order_number_idx on orders(order_number);
create index orders_status_idx on orders(status);
create index orders_created_at_idx on orders(created_at);

-- ---------- events (private venue rentals: deposit -> balance -> paid) ----------
create table events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id),
  order_id uuid references orders(id),
  event_name text not null default 'Untitled event',
  movie_title text,
  guest_count int,
  pizza_count int,
  hours numeric(5,2) not null,
  event_date date not null,
  event_time time not null,
  organizer_name text,
  organizer_email text not null,
  estimate_total numeric(10,2) not null,
  deposit_paid numeric(10,2) not null default 0,
  balance_due numeric(10,2) not null default 0,
  status text not null default 'outstanding' check (status in ('outstanding', 'paid')),
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create index events_event_date_idx on events(event_date);

create table event_addon_selections (
  event_id uuid not null references events(id) on delete cascade,
  room_addon_id uuid not null references room_addons(id),
  primary key (event_id, room_addon_id)
);

-- ---------- order_items ----------
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id),
  name text not null,
  unit_price numeric(10,2) not null,
  quantity int not null default 1 check (quantity > 0),
  -- flat array of modifier display strings, snapshotted at sale time
  -- (mirrors line.mods in rcl-pos.html) rather than normalized, since a
  -- later edit to a modifier group/option must not rewrite historical orders
  modifiers jsonb not null default '[]'::jsonb,
  is_event boolean not null default false,
  is_alcohol boolean not null default false,
  linked_event_id uuid references events(id),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on order_items(order_id);

-- ---------- bookings (general-admission ticket sales) ----------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  screening_id uuid not null references screenings(id) on delete cascade,
  order_id uuid references orders(id),
  member_id uuid references members(id),
  customer_name text,
  customer_email text,
  quantity int not null default 1 check (quantity > 0),
  unit_price numeric(10,2) not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'refunded', 'cancelled')),
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

create index bookings_screening_id_idx on bookings(screening_id);

-- ---------- Row Level Security ----------
-- Catalog data (what's playing, what's on the menu, what rooms exist) is
-- public-readable for the website. Everything else defaults to locked down;
-- writes go through server-side code using the service role key until
-- per-surface policies (POS write access, member self-service, staff auth)
-- are designed alongside those features.

alter table rooms enable row level security;
alter table room_addons enable row level security;
alter table movies enable row level security;
alter table screenings enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table menu_modifier_groups enable row level security;
alter table menu_modifier_options enable row level security;
alter table settings enable row level security;
alter table employees enable row level security;
alter table members enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table events enable row level security;
alter table event_addon_selections enable row level security;
alter table bookings enable row level security;

create policy "public read rooms" on rooms for select using (true);
create policy "public read room_addons" on room_addons for select using (true);
create policy "public read movies" on movies for select using (true);
create policy "public read screenings" on screenings for select using (true);
create policy "public read menu_categories" on menu_categories for select using (true);
create policy "public read menu_items" on menu_items for select using (true);
create policy "public read menu_modifier_groups" on menu_modifier_groups for select using (true);
create policy "public read menu_modifier_options" on menu_modifier_options for select using (true);
