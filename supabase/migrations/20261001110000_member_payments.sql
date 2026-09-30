-- Member payments in Reports: every Insiders+ card charge Stripe makes (a
-- new membership, a monthly or yearly renewal, a switch to yearly), every
-- gift membership, and refunds of either, one row each. Reports (Day, Week,
-- Month, Sales tax, Members) and the daily email add these up next to the
-- register and the website.
--
-- Filled by a sync that reads Stripe (src/lib/membership-payments/sync.ts):
-- at the start of the daily-report cron, when a Reports page is opened and
-- the last read is over 10 minutes old, from the Stripe webhook for a
-- first payment, and by scripts/backfill-member-payments.mjs. Nothing here
-- changes Stripe. Each row is keyed by the Stripe id it came from
-- (source_id), so reading the same payment twice never counts it twice.
--
-- Money is in cents. A refund is its own row with negative amounts, counted
-- on the day of the payment it gives back (like register partial refunds),
-- so Reports add up every row as it is: never filter on status.
--   kind      plus_new | plus_renewal | plus_switch (monthly to yearly) |
--             plus_change (another plan change Stripe charged for) | gift | refund
--   product   plus | gift (a refund row: what was refunded)
--   amount    money in, tax included (invoice amount_paid; gift price + tax)
--   sales     before tax (invoice total_excluding_tax; gift price)
--   tax       the sales tax Stripe added
--   paid_at   when the money moved (a refund: when it was refunded)
--   counted_at / business_date   the instant and 4 a.m.-to-4 a.m. Central
--             day Reports count it on (a refund: its payment's)
--
-- Server-only, like the rest: RLS on, no client policies. Additive and safe
-- to run more than once.

create table if not exists member_payments (
  id uuid primary key default gen_random_uuid(),
  -- 'in_...' (an Insiders+ invoice), 'gift:<gift_memberships.id>', 're_...' (a refund)
  source_id text not null unique,
  kind text not null,
  product text not null check (product in ('plus', 'gift')),
  member_id uuid references members(id) on delete set null,
  tier text check (tier in ('adult', 'senior', 'student')),
  billing_interval text check (billing_interval in ('month', 'year')),
  amount_cents int not null,
  sales_cents int not null,
  tax_cents int not null,
  paid_at timestamptz not null,
  counted_at timestamptz not null,
  business_date date not null,
  -- Informational only (Reports add up every row): paid, partly_refunded or
  -- refunded on a payment; succeeded on a refund.
  status text not null default 'paid' check (status in ('paid', 'partly_refunded', 'refunded', 'succeeded')),
  billing_reason text,
  -- What an Insiders+ charge covers; period_end is the next bill.
  period_start timestamptz,
  period_end timestamptz,
  stripe_invoice_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_refund_id text,
  stripe_credit_note_id text,
  gift_membership_id uuid references gift_memberships(id) on delete set null,
  refund_of uuid references member_payments(id) on delete cascade,
  livemode boolean not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The kinds, as a named check, so running this again brings it up to date.
alter table member_payments drop constraint if exists member_payments_kind_check;
alter table member_payments
  add constraint member_payments_kind_check check (kind in ('plus_new', 'plus_renewal', 'plus_switch', 'plus_change', 'gift', 'refund'));

create index if not exists member_payments_counted_at on member_payments (counted_at);
create index if not exists member_payments_business_date on member_payments (business_date);
create index if not exists member_payments_paid_at on member_payments (paid_at);
create index if not exists member_payments_member on member_payments (member_id);
create index if not exists member_payments_payment_intent on member_payments (stripe_payment_intent_id);
create index if not exists member_payments_subscription on member_payments (stripe_subscription_id);
create index if not exists member_payments_refund_of on member_payments (refund_of);

alter table member_payments enable row level security;

-- Insiders+ subscriptions that ended (cancelled, or stopped after failed
-- payments), for "cancelled" on the Members tab and the Week and Month
-- reports. Read from Stripe's customer.subscription.deleted events by the
-- same sync, and recorded by the webhook as it happens.
create table if not exists member_subscription_ends (
  id uuid primary key default gen_random_uuid(),
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  member_id uuid references members(id) on delete set null,
  tier text check (tier in ('adult', 'senior', 'student')),
  billing_interval text check (billing_interval in ('month', 'year')),
  ended_at timestamptz not null,
  business_date date not null,
  -- Stripe's cancellation_details.reason: cancellation_requested,
  -- payment_failed, payment_disputed (never the member's own comment).
  reason text,
  livemode boolean not null,
  synced_at timestamptz not null default now()
);

create index if not exists member_subscription_ends_ended_at on member_subscription_ends (ended_at);

alter table member_subscription_ends enable row level security;

-- One row: when the sync last read Stripe, so Reports know whether to read
-- again, and a run in progress isn't started twice.
--   started_at      a run in progress since then (claimed below)
--   run_id          the run holding the claim: only it writes the row afterwards
--   finished_at     the last run ended, well or not (Reports wait 10 minutes after it)
--   succeeded_at    the last run that worked ("Last read from Stripe")
--   invoices_through / refunds_through   what the last good run read up to
create table if not exists member_payment_sync (
  id boolean primary key default true check (id),
  started_at timestamptz,
  run_id uuid,
  finished_at timestamptz,
  succeeded_at timestamptz,
  invoices_through timestamptz,
  refunds_through timestamptz,
  last_error text,
  last_result jsonb
);

alter table member_payment_sync add column if not exists run_id uuid;

insert into member_payment_sync (id) values (true) on conflict do nothing;

alter table member_payment_sync enable row level security;

-- Claims the next sync run. Returns a new run id (and sets started_at to
-- now) only when the last run ended more than p_fresh_seconds ago and none
-- is in progress (or the one in progress started over p_lock_seconds ago
-- and is taken to have died); otherwise null. The row lock makes two
-- callers at the same moment take turns, so only one of them gets an id.
-- The run then writes the row only where run_id is still its own, so a run
-- that was taken over can't release or overwrite the newer run's claim.
drop function if exists public.claim_member_payment_sync(int, int);
create or replace function public.claim_member_payment_sync(p_fresh_seconds int, p_lock_seconds int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed uuid;
begin
  insert into member_payment_sync (id) values (true) on conflict do nothing;
  update member_payment_sync
     set started_at = now(),
         run_id = gen_random_uuid()
   where id
     and (finished_at is null or finished_at <= now() - make_interval(secs => p_fresh_seconds))
     and (
       started_at is null
       or (finished_at is not null and started_at <= finished_at)
       or started_at < now() - make_interval(secs => p_lock_seconds)
     )
  returning run_id into claimed;
  return claimed;
end;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.claim_member_payment_sync(int, int) from public, anon, authenticated;
grant execute on function public.claim_member_payment_sync(int, int) to service_role;
