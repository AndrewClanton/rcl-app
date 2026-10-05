-- Organization (corporate) accounts (Andrew, 10/5): groups like Easter
-- Seals and Arc of the Ozarks bring people with disabilities and their
-- helpers to the lounge. The organization pays a monthly fee and gets a
-- number of comps a day; a comp is one person's day pass (their movies that
-- business day included). Helpers sign up with their work email through an
-- invite link; supported guests are often phone accounts.
--
--   organizations       one row per organization: contact, monthly fee,
--                       daily comp limit (20 = 10 pairs of a supported
--                       guest and a helper), status, Stripe billing ids
--                       (null: invoiced by hand), the invite code, notes.
--   members.organization_id / org_role
--                       who belongs: 'helper' (work-email accounts) or
--                       'supported' (the guests themselves, who also get
--                       tax-included, even-dollar totals at the register).
--   org_comps           every comp the register gave: the org, the person,
--                       the business date, a day pass or a movie, the price
--                       it would have been, the order, and the manager who
--                       went past the daily limit (if one did).
--   orders.organization_id / org_comp_discount / tax_included
--                       on a sale: whose comps came off, how much, and
--                       whether the total had the tax inside it.
--
-- members.organization (the free-text label, 20261005030000) stays: Back
-- office turns a label into an organization and attaches everyone with it.
--
-- Server-only like the other staff tables: RLS on, no client policies.
-- Additive and safe to run more than once.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  contact_email text check (contact_email is null or length(contact_email) <= 200),
  monthly_fee numeric(10, 2) not null default 100 check (monthly_fee >= 0),
  daily_comp_limit integer not null default 20 check (daily_comp_limit between 0 and 500),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  stripe_customer_id text,
  stripe_subscription_id text,
  invite_code text not null default replace(gen_random_uuid()::text, '-', ''),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create unique index if not exists organizations_name_key on organizations (lower(name));
create unique index if not exists organizations_invite_key on organizations (invite_code);
alter table organizations enable row level security;
grant select, insert, update, delete on public.organizations to service_role;

alter table members add column if not exists organization_id uuid references organizations(id) on delete set null;
alter table members add column if not exists org_role text check (org_role is null or org_role in ('helper', 'supported'));
create index if not exists members_organization_id_idx on members (organization_id) where organization_id is not null;

create table if not exists org_comps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id uuid not null, -- no foreign key: merge_members refuses accounts one points at (see 20261005030000)
  business_date date not null,
  kind text not null check (kind in ('day_pass', 'movie')),
  screening_id uuid,
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  order_id uuid references orders(id) on delete cascade,
  over_limit_by uuid references employees(id) on delete set null,
  over_limit boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists org_comps_org_day_idx on org_comps (organization_id, business_date);
create index if not exists org_comps_member_day_idx on org_comps (member_id, business_date);
create index if not exists org_comps_order_idx on org_comps (order_id);
alter table org_comps enable row level security;
grant select, insert, delete on public.org_comps to service_role;

alter table orders add column if not exists organization_id uuid references organizations(id) on delete set null;
alter table orders add column if not exists org_comp_discount numeric(10, 2) not null default 0;
alter table orders add column if not exists tax_included boolean not null default false;

-- A merge moves the duplicate's comps onto the kept account, and its
-- organization when the kept account has none.
create or replace function public.org_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update org_comps set member_id = new.keep_id where member_id = new.dropped_id;
  update members k set organization_id = d.organization_id, org_role = d.org_role
    from members d
    where k.id = new.keep_id and d.id = new.dropped_id and k.organization_id is null and d.organization_id is not null;
  return null;
end;
$$;
drop trigger if exists org_member_merged on member_merges;
create trigger org_member_merged after insert on member_merges
  for each row execute function public.org_member_merged();

-- Removing a member's personal info takes them out of their organization
-- (their past comps stay on the organization's statement, unnamed).
create or replace function public.members_erase_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    update members set organization_id = null, org_role = null where id = new.id and organization_id is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_org on members;
create trigger members_erase_org after update of erased_at on members
  for each row execute function public.members_erase_org();

revoke execute on function public.org_member_merged() from public, anon, authenticated;
revoke execute on function public.members_erase_org() from public, anon, authenticated;
