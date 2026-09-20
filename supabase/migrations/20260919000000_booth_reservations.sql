-- Booth reservations: paying online to hold one of the lounge's 8 physical
-- booths for a time block, independent of any screening. This is a new
-- concept distinct from `bookings` (hard-tied to a screening_id) and
-- `events` (whole-room private rentals) -- booths are fixed, individually
-- named seating units with their own availability calendar.

create table booths (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  capacity int not null default 4,
  reservation_fee numeric(10,2) not null default 25,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table booth_reservations (
  id uuid primary key default gen_random_uuid(),
  booth_id uuid not null references booths(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  party_size int not null check (party_size > 0),
  reservation_date date not null,
  -- Wall-clock start time for the venue itself, same convention as
  -- events.event_time -- not a UTC instant.
  start_time time not null,
  hours numeric(4,2) not null default 2,
  fee_amount numeric(10,2) not null,
  -- Same pending -> confirmed/cancelled lifecycle as bookings: the row is
  -- inserted as 'pending' the moment Checkout starts (holding the booth so
  -- nobody else can book the same slot while payment is in progress), then
  -- the webhook flips it based on whether payment actually completed.
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

create index booth_reservations_booth_date_idx on booth_reservations(booth_id, reservation_date);
create index booth_reservations_stripe_checkout_session_id_idx on booth_reservations (stripe_checkout_session_id) where stripe_checkout_session_id is not null;

insert into booths (label, sort_order) values
  ('Booth 1', 1), ('Booth 2', 2), ('Booth 3', 3), ('Booth 4', 4),
  ('Booth 5', 5), ('Booth 6', 6), ('Booth 7', 7), ('Booth 8', 8);

-- Same posture as events/members: reservations carry customer contact info,
-- so no public read policy -- always read via the service-role client.
-- Booths themselves (label/capacity/fee) are locked down too since the
-- public page fetches them server-side, same as the rest of the site.
alter table booths enable row level security;
alter table booth_reservations enable row level security;
