-- Member accounts: a points history members can trust, email preferences,
-- and "who comes in most" for the register's photo lookup.

-- ---------- points history ----------
-- Every change to members.points goes through apply_member_points(), which
-- updates the balance and writes a ledger row in one transaction, so the
-- history always adds up to the balance.
create table if not exists points_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  delta numeric(10,2) not null,
  balance_after numeric(10,2) not null,
  reason text not null check (reason in ('purchase', 'redeem', 'refund', 'welcome_bonus', 'adjustment', 'opening_balance')),
  order_id uuid references orders(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  note text,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists points_ledger_member_idx on points_ledger(member_id, created_at desc);
-- A purchase earns once, even if a payment webhook is delivered twice.
create unique index if not exists points_ledger_order_earn_idx on points_ledger(order_id) where reason = 'purchase' and order_id is not null;
create unique index if not exists points_ledger_booking_earn_idx on points_ledger(booking_id) where reason = 'purchase' and booking_id is not null;
alter table points_ledger enable row level security;

create or replace function public.apply_member_points(
  p_member uuid,
  p_delta numeric,
  p_reason text,
  p_order uuid default null,
  p_booking uuid default null,
  p_note text default null,
  p_by uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  update members set points = points + p_delta where id = p_member returning points into new_balance;
  if new_balance is null then
    raise exception 'member % not found', p_member;
  end if;
  insert into points_ledger (member_id, delta, balance_after, reason, order_id, booking_id, note, created_by)
  values (p_member, p_delta, new_balance, p_reason, p_order, p_booking, p_note, p_by);
  return new_balance;
end;
$$;

-- A refund takes back what that purchase earned and returns what it
-- redeemed. Runs once per purchase.
create or replace function public.reverse_purchase_points(p_order uuid, p_booking uuid, p_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_total numeric;
begin
  if exists (
    select 1 from points_ledger
    where reason = 'refund' and ((p_order is not null and order_id = p_order) or (p_booking is not null and booking_id = p_booking))
  ) then
    return null;
  end if;
  select member_id, sum(delta) into v_member, v_total
  from points_ledger
  where reason in ('purchase', 'redeem') and ((p_order is not null and order_id = p_order) or (p_booking is not null and booking_id = p_booking))
  group by member_id
  limit 1;
  if v_member is null or v_total = 0 then
    return null;
  end if;
  return public.apply_member_points(v_member, -v_total, 'refund', p_order, p_booking, 'Purchase refunded', p_by);
end;
$$;

-- Start everyone's history from the balance they have today.
insert into points_ledger (member_id, delta, balance_after, reason, note)
select m.id, m.points, m.points, 'opening_balance', 'Balance when your points history started'
from members m
where m.points <> 0
  and not exists (select 1 from points_ledger l where l.member_id = m.id);

-- ---------- email preferences ----------
alter table members add column if not exists email_opt_in boolean not null default true;
alter table members add column if not exists email_opt_in_changed_at timestamptz;

-- ---------- who comes in most (register photo lookup) ----------
-- A visit is a day with a completed register order or a screening they had
-- a ticket for.
create or replace function public.frequent_members(p_since timestamptz, p_limit int)
returns table (member_id uuid, visits bigint, last_visit timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select o.member_id, o.completed_at as at
    from orders o
    where o.status = 'completed' and o.member_id is not null and o.completed_at >= p_since
    union all
    select b.member_id, s.starts_at
    from bookings b join screenings s on s.id = b.screening_id
    where b.status = 'confirmed' and b.member_id is not null and s.starts_at >= p_since and s.starts_at <= now()
  )
  select v.member_id, count(distinct (v.at at time zone 'America/Chicago')::date) as visits, max(v.at) as last_visit
  from v
  group by v.member_id
  order by visits desc, last_visit desc
  limit p_limit;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.apply_member_points(uuid, numeric, text, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.reverse_purchase_points(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.frequent_members(timestamptz, int) from public, anon, authenticated;
grant execute on function public.apply_member_points(uuid, numeric, text, uuid, uuid, text, uuid) to service_role;
grant execute on function public.reverse_purchase_points(uuid, uuid, uuid) to service_role;
grant execute on function public.frequent_members(timestamptz, int) to service_role;
