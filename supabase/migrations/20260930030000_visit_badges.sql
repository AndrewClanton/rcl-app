-- Check-in badges and the week streak (src/lib/visits.ts), replacing the
-- daily streak ladder. Every confirmed check-in pays a flat 5 points, once
-- per business day. Badges pay once when earned (the first visit, an early
-- or late check-in, 4/13/26/52 weeks in a row, the 10th/50th/100th visit,
-- and a visit in their birthday week, once a year); the 13- and 26-week
-- badges also give a free popcorn and a free pizza (member_rewards).
--
-- Which badges a visit earns is decided in the app (lib/visits.ts); this
-- pays them, in one transaction per visit, never twice:
--   - member_visits stays unique per member and business day, so two
--     registers confirming the same person at once make one visit;
--   - award_member_visit locks that visit and pays it only if it hasn't
--     been paid, so a retry or a second register can't pay it again;
--   - member_badges is unique per member, badge and period, and a badge
--     pays only when its row is actually inserted.
--
-- member_visits.streak now holds the week streak as of that visit (it was
-- the daily streak before; the one visit from before this keeps its value).
-- member_visit_streak (the daily count) is left in place, unused.
--
-- Additive and safe to run twice. Server-only, like the rest: RLS on, no
-- client policies, functions for service_role only.

-- ---------- birthdays ----------
-- For the Birthday Visit badge. Only the month and day mean anything; the
-- app stores the year as 2000 (a leap year, so Feb 29 fits).
alter table members add column if not exists birthday date;

-- ---------- badges ----------
create table if not exists member_badges (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  badge text not null, -- 'welcome', 'night_owl', 'weeks_13'... (BADGES in src/lib/visits.ts)
  period text not null default '', -- '' for a once-ever badge; the birthday's year for 'birthday'
  earned_at timestamptz not null default now(),
  visit_id uuid references member_visits(id) on delete set null,
  points int not null default 0, -- what it paid
  unique (member_id, badge, period)
);
alter table member_badges enable row level security;

comment on column member_visits.streak is 'Weeks in a row as of this visit (member_week_streak). Before 2026-09-30: days in a row.';

-- Badge points get their own reason in the points history.
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.points_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%';
  if c is not null then execute format('alter table points_ledger drop constraint %I', c); end if;
end $$;
alter table points_ledger add constraint points_ledger_reason_check
  check (reason in ('purchase', 'redeem', 'refund', 'welcome_bonus', 'adjustment', 'opening_balance', 'visit', 'badge'));

-- ---------- the week streak ----------
-- How many Monday-to-Sunday weeks in a row (by business date), counting
-- back from p_date's week, the member checked in at least once. A week the
-- Royale was closed (no check-in by anyone, no completed or refunded sale)
-- doesn't break it, the way closed days don't break member_visit_streak.
-- p_date's own week, if they haven't come in yet, doesn't count and doesn't
-- break it either: that week isn't over. Looks no further back than their
-- first visit.
create or replace function public.member_week_streak(p_member uuid, p_date date)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  this_week date := p_date - (extract(isodow from p_date)::int - 1);
  wk date;
  first_visit date;
  streak int := 0;
  was_open boolean;
begin
  select min(business_date) into first_visit from member_visits where member_id = p_member and business_date <= p_date;
  if first_visit is null then
    return 0;
  end if;
  wk := this_week;
  while wk >= first_visit - (extract(isodow from first_visit)::int - 1) loop
    if exists (select 1 from member_visits where member_id = p_member and business_date >= wk and business_date < wk + 7 and business_date <= p_date) then
      streak := streak + 1;
    elsif wk <> this_week then
      -- Business days run 4 a.m. to 4 a.m. Central, so the week's sales are
      -- the ones from its Monday 4 a.m. to the next Monday's.
      was_open := exists (select 1 from member_visits where business_date >= wk and business_date < wk + 7)
        or exists (
          select 1 from orders
          where status in ('completed', 'refunded')
            and created_at >= ((wk::timestamp + interval '4 hours') at time zone 'America/Chicago')
            and created_at < (((wk + 7)::timestamp + interval '4 hours') at time zone 'America/Chicago')
        );
      if was_open then
        exit;
      end if;
    end if;
    wk := wk - 7;
  end loop;
  return streak;
end;
$$;

-- ---------- paying a visit ----------
-- Pays a visit that's been recorded: p_points for the check-in, then each
-- badge in p_badges ([{key, period, points, reward, note, reason}], from
-- badgesFor in lib/visits.ts) that the member doesn't already have, with
-- its reward. Returns {paid, balance, badges: [keys paid]}. paid is false
-- if the visit was paid already (by another register a moment ago, say):
-- then nothing changes.
create or replace function public.award_member_visit(p_visit uuid, p_points numeric, p_week_streak int, p_badges jsonb, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v member_visits%rowtype;
  b jsonb;
  badge_id uuid;
  bal numeric;
  total numeric := 0;
  paid_badges jsonb := '[]'::jsonb;
begin
  select * into v from member_visits where id = p_visit for update;
  if not found then
    raise exception 'visit % not found', p_visit;
  end if;
  if v.points_awarded is not null or exists (select 1 from members where id = v.member_id and erased_at is not null) then
    select points into bal from members where id = v.member_id;
    return jsonb_build_object('paid', false, 'balance', coalesce(bal, 0), 'badges', '[]'::jsonb);
  end if;

  if coalesce(p_points, 0) <> 0 then
    perform public.apply_member_points(v.member_id, p_points, 'visit', null, null, 'Check-in', p_by);
    total := total + p_points;
  end if;

  for b in select value from jsonb_array_elements(coalesce(p_badges, '[]'::jsonb)) loop
    badge_id := null;
    insert into member_badges (member_id, badge, period, visit_id, points)
    values (v.member_id, b->>'key', coalesce(b->>'period', ''), v.id, coalesce((b->>'points')::int, 0))
    on conflict (member_id, badge, period) do nothing
    returning id into badge_id;
    if badge_id is not null then
      if coalesce((b->>'points')::numeric, 0) <> 0 then
        perform public.apply_member_points(v.member_id, (b->>'points')::numeric, 'badge', null, null, b->>'note', p_by);
        total := total + (b->>'points')::numeric;
      end if;
      if b->>'reward' is not null then
        insert into member_rewards (member_id, kind, reason, earned_on)
        values (v.member_id, b->>'reward', coalesce(b->>'reason', b->>'note', 'Badge'), v.business_date)
        on conflict (member_id, kind, earned_on) do nothing;
      end if;
      paid_badges := paid_badges || jsonb_build_array(b->>'key');
    end if;
  end loop;

  update member_visits set streak = p_week_streak, points_awarded = total where id = v.id;
  select points into bal from members where id = v.member_id;
  return jsonb_build_object('paid', true, 'balance', bal, 'badges', paid_badges);
end;
$$;

-- ---------- removing a member's personal info ----------
-- erase_member_personal_info (20260929220000) sets erased_at; when it does,
-- their birthday and badges go too (a birthday badge would say when it is).
create or replace function public.members_erase_badges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.erased_at is not null and old.erased_at is null then
    new.birthday := null;
    delete from member_badges where member_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists members_erase_badges on members;
create trigger members_erase_badges before update of erased_at on members
  for each row execute function public.members_erase_badges();

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.member_week_streak(uuid, date) from public, anon, authenticated;
revoke execute on function public.award_member_visit(uuid, numeric, int, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.member_week_streak(uuid, date) to service_role;
grant execute on function public.award_member_visit(uuid, numeric, int, jsonb, uuid) to service_role;
