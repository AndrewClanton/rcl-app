-- Check-in visits, streaks and streak rewards (src/lib/visits.ts).
-- Checking in on the customer screen (confirmed by staff) is a visit: once
-- per member per business day (4 a.m. to 4 a.m. Central), with points that
-- grow with their streak, and a reward at certain streak lengths (free
-- popcorn at 7, free pizza at 30). Additive and safe to run twice.

create table if not exists member_visits (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  business_date date not null,
  checked_in_at timestamptz not null default now(),
  streak int,
  points_awarded numeric(10,2),
  confirmed_by uuid references employees(id) on delete set null,
  unique (member_id, business_date)
);
create index if not exists member_visits_date_idx on member_visits (business_date);
alter table member_visits enable row level security;

create table if not exists member_rewards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null, -- 'popcorn', 'pizza' (labels live in src/lib/visits.ts)
  reason text not null, -- "7-day streak"
  earned_on date not null,
  earned_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references employees(id) on delete set null,
  unique (member_id, kind, earned_on)
);
create index if not exists member_rewards_open_idx on member_rewards (member_id) where redeemed_at is null;
alter table member_rewards enable row level security;

-- Visit points get their own reason in the points history.
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.points_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%';
  if c is not null then execute format('alter table points_ledger drop constraint %I', c); end if;
end $$;
alter table points_ledger add constraint points_ledger_reason_check
  check (reason in ('purchase', 'redeem', 'refund', 'welcome_bonus', 'adjustment', 'opening_balance', 'visit'));

-- A member's streak on p_date: how many open days in a row, counting back
-- from p_date, they checked in. An "open day" is a business day the Royale
-- had any sale or check-in, so days it's closed don't break a streak.
-- Looks back 120 days at most.
create or replace function public.member_visit_streak(p_member uuid, p_date date)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  streak int := 0;
  d date;
begin
  for d in
    select day from (
      select business_date as day from member_visits where business_date between p_date - 120 and p_date
      union
      select ((created_at at time zone 'America/Chicago') - interval '4 hours')::date
        from orders
        where created_at >= ((p_date - 121)::timestamp at time zone 'America/Chicago')
          and status in ('completed', 'refunded')
    ) open_days
    where day <= p_date
    order by day desc
  loop
    if exists (select 1 from member_visits where member_id = p_member and business_date = d) then
      streak := streak + 1;
    else
      exit;
    end if;
  end loop;
  return streak;
end;
$$;

revoke execute on function public.member_visit_streak(uuid, date) from public, anon, authenticated;
grant execute on function public.member_visit_streak(uuid, date) to service_role;
