-- Gift memberships: someone pays once, at the box office, for a year of
-- Insiders+ for someone else. No subscription and no card on the friend's
-- account; the perks simply run until plus_gift_until. Additive and safe
-- to run twice.

-- When the friend's gifted Insiders+ runs out. The daily cron turns the
-- perks off after this, unless a subscription or a comp covers them.
alter table members add column if not exists plus_gift_until timestamptz;

create table if not exists gift_memberships (
  id uuid primary key default gen_random_uuid(),
  recipient_member_id uuid not null references members(id),
  buyer_name text not null,
  buyer_email text not null,
  message text,
  months int not null default 12,
  price numeric(10,2) not null,
  -- The sales tax Stripe added on top, once paid.
  tax_amount numeric(10,2) not null default 0,
  -- pending: payment page opened; paid: the year was added; cancelled: the
  -- payment page expired unpaid.
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  -- The stretch this gift covers (it starts where an earlier gift ends).
  starts_at timestamptz,
  ends_at timestamptz,
  sold_by uuid references employees(id),
  paid_at timestamptz,
  -- Each email goes once: claimed before sending, released if it fails.
  recipient_emailed_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gift_memberships_recipient on gift_memberships (recipient_member_id);
create index if not exists members_plus_gift_until on members (plus_gift_until) where plus_gift_until is not null;

-- Server-only, like the rest: no client policies.
alter table gift_memberships enable row level security;
