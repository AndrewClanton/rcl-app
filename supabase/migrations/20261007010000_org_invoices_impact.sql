-- Organization invoices and the Community impact tab (Andrew, 10/7).
--
-- Some organizations get events, rentals or services at a big discount
-- (Arc of the Ozarks: four events worth $400 each, charged $50). The
-- Royale Cinema Project (the 501(c)(3)) covers the difference. At month end
-- staff email the organization one invoice/receipt with those lines, the
-- month's comps (covered at menu value) and the monthly fee when it's
-- invoiced by hand (src/lib/org-invoices.ts).
--
--   org_invoice_lines   one discounted event, rental or service: the date,
--                       what it was, its full value, the amount charged,
--                       and (optional) how many people it served.
--   org_invoices        one row per organization and month, made when staff
--                       first change it: payment status (unpaid, paid by
--                       cash/check/card, waived), whether the monthly fee is
--                       on it, and the Stripe payment link (made only when
--                       staff press "Make a pay-by-card link").
--   org_invoice_sends   every invoice email: to whom, by whom, when, and
--                       the amounts it showed.
--   community_activities (and a category on it and on organizations)
--                       one-off community service that isn't an org comp:
--                       "free screening for assisted living residents, 22
--                       people, value $176". Optionally tied to an
--                       organization.
--
-- Server-only like the other staff tables: RLS on, no client policies.
-- Additive and safe to run more than once.

create table if not exists org_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  service_date date not null,
  kind text not null default 'event' check (kind in ('event', 'rental', 'service')),
  description text not null check (length(description) between 1 and 200),
  full_value numeric(10, 2) not null check (full_value >= 0 and full_value <= 1000000),
  amount_charged numeric(10, 2) not null check (amount_charged >= 0 and amount_charged <= full_value),
  people integer check (people is null or people between 0 and 10000),
  created_by uuid references employees(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists org_invoice_lines_org_date_idx on org_invoice_lines (organization_id, service_date);
create index if not exists org_invoice_lines_date_idx on org_invoice_lines (service_date);
alter table org_invoice_lines enable row level security;
grant select, insert, delete on public.org_invoice_lines to service_role;

create table if not exists org_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived')),
  paid_method text check (paid_method is null or paid_method in ('cash', 'check', 'card')),
  paid_at timestamptz,
  status_by uuid references employees(id) on delete set null,
  status_by_name text check (status_by_name is null or length(status_by_name) <= 120),
  include_fee boolean,
  pay_link_id text,
  pay_link_url text,
  pay_link_amount numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, month)
);
create index if not exists org_invoices_pay_link_idx on org_invoices (pay_link_id) where pay_link_id is not null;
alter table org_invoices enable row level security;
grant select, insert, update, delete on public.org_invoices to service_role;

create table if not exists org_invoice_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  month text not null,
  email text not null check (length(email) <= 200),
  kind text not null default 'invoice' check (kind in ('invoice', 'receipt')),
  amount_due numeric(10, 2) not null default 0,
  covered numeric(10, 2) not null default 0,
  sent_by uuid references employees(id) on delete set null,
  sent_by_name text check (sent_by_name is null or length(sent_by_name) <= 120),
  resend_id text,
  created_at timestamptz not null default now()
);
create index if not exists org_invoice_sends_org_idx on org_invoice_sends (organization_id, month, created_at desc);
alter table org_invoice_sends enable row level security;
grant select, insert, delete on public.org_invoice_sends to service_role;

create table if not exists community_activities (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  organization_id uuid references organizations(id) on delete set null,
  description text not null check (length(description) between 1 and 200),
  people integer not null default 0 check (people between 0 and 100000),
  value numeric(10, 2) not null default 0 check (value >= 0 and value <= 1000000),
  created_by uuid references employees(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists community_activities_date_idx on community_activities (activity_date);
alter table community_activities enable row level security;
grant select, insert, delete on public.community_activities to service_role;

-- Who the Royale Cinema Project serves, for the impact report: each
-- organization and each one-off activity carries one category. The
-- organizations so far are disability groups, so that's the default.
alter table organizations add column if not exists impact_category text not null default 'disabilities';
alter table community_activities add column if not exists category text not null default 'other';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_impact_category_check') then
    alter table organizations add constraint organizations_impact_category_check
      check (impact_category in ('disabilities', 'seniors', 'students', 'neighborhood', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'community_activities_category_check') then
    alter table community_activities add constraint community_activities_category_check
      check (category in ('disabilities', 'seniors', 'students', 'neighborhood', 'other'));
  end if;
end $$;

-- The nonprofit's EIN lives in settings (key 'nonprofit_ein', a string),
-- edited on the Community impact tab.
-- Prefilled from the IRS record (Royale Cinema Project Co, 501(c)(3),
-- ruling April 2025); an owner's later edit is kept.
insert into settings (key, value) values ('nonprofit_ein', '"99-4086131"'::jsonb)
  on conflict (key) do nothing;
