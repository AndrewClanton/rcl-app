-- More things to spend points on (Andrew, 10/7).
--
--   reward_catalog      what points buy: real goods (popcorn, a soda, a
--                       drink...), the register's $5 off, and vanity perks
--                       (a sign-in sound, an entrance, a card frame, a name
--                       color, a title). Owners and admins edit it in Back
--                       office -> Points. Seeded with a starter set below.
--   reward_redemptions  every time points were spent on the catalog: who,
--                       what, how many points, what it cost us, the order
--                       (for goods). 'returned' once the sale is refunded.
--   member_perks        the vanity perks a member owns (for good, or until
--                       expires_at).
--   points_settings     one row: the daily earning ceilings and the
--                       per-member limits on redeeming goods.
--   points_held_back    points the daily ceiling kept from being paid, for
--                       the watch list.
--   checkin_attempts    every check-in try (paid or "welcome back"), with
--                       the screen or door it came from, for the watch list.
--
-- Spending never lowers what a member has earned: points_ledger already
-- keeps every change with its reason, and member_points_totals (below)
-- splits it into lifetime earned and spent. Spending is 'redeem' rows, so a
-- refund gives reward points back the way it always has
-- (reverse_purchase_points sums 'purchase' and 'redeem').
--
-- No foreign keys to members, on purpose (like member_flags): merge_members
-- refuses to merge an account that a foreign key points at. Triggers move
-- the rows on a merge and remove them when an account is deleted.
--
-- Server-only like the other staff tables: RLS on, no client policies, the
-- app reads and writes with the service role. Safe to run more than once.

-- ---------- settings ----------
create table if not exists points_settings (
  id boolean primary key default true check (id),
  -- Check-in and badge points in one business day, at most (0: no cap).
  -- 600 clears the biggest real day (a 52-week badge with a birthday).
  bonus_daily_cap integer not null default 600 check (bonus_daily_cap >= 0),
  -- Everything earned in one business day (purchases, check-ins, badges),
  -- at most (0: no cap).
  earn_daily_cap integer not null default 2500 check (earn_daily_cap >= 0),
  -- Real goods a member can redeem, across the whole catalog (0: no limit).
  goods_daily_limit integer not null default 3 check (goods_daily_limit >= 0),
  goods_monthly_limit integer not null default 20 check (goods_monthly_limit >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null
);
insert into points_settings (id) values (true) on conflict (id) do nothing;
alter table points_settings enable row level security;
grant select, insert, update on public.points_settings to service_role;

-- ---------- the catalog ----------
create table if not exists reward_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  -- good: handed over at the bar, a $0 line on the order.
  -- discount: the register's $5 off (its points are the register's rule).
  -- perk: unlocks on the account at once.
  kind text not null check (kind in ('good', 'discount', 'perk')),
  -- For a perk: which slot it fills, and the key into the screen's own
  -- catalog (src/lib/rewards.ts). 'mobile' is for mobile ordering, which
  -- isn't built yet: shown as coming soon, never sold.
  perk_slot text check (perk_slot is null or perk_slot in ('sound', 'entrance', 'frame', 'name_color', 'title', 'mobile')),
  perk_key text check (perk_key is null or char_length(perk_key) <= 24),
  -- How long a perk lasts once unlocked; null: for good.
  perk_days integer check (perk_days is null or perk_days between 1 and 3650),
  points integer not null check (points between 1 and 100000),
  -- What one costs Royale Cinema (the economy summary); null: not known.
  real_cost numeric(8,2) check (real_cost is null or real_cost >= 0),
  -- Alcohol: the register checks ID like any drink.
  is_alcohol boolean not null default false,
  -- Per member, by business day and month (Central, 4 AM to 4 AM); null: no limit.
  daily_limit integer check (daily_limit is null or daily_limit >= 1),
  monthly_limit integer check (monthly_limit is null or monthly_limit >= 1),
  -- How many are left; null: not counted.
  stock integer check (stock is null or stock >= 0),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null,
  check ((kind = 'perk') = (perk_slot is not null)),
  check (kind <> 'perk' or perk_key is not null)
);
create unique index if not exists reward_catalog_perk_idx on reward_catalog (perk_slot, perk_key) where kind = 'perk';
create unique index if not exists reward_catalog_discount_idx on reward_catalog (kind) where kind = 'discount';
alter table reward_catalog enable row level security;
grant select, insert, update, delete on public.reward_catalog to service_role;

-- ---------- redemptions ----------
create table if not exists reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null, -- no foreign key: see the top
  reward_id uuid references reward_catalog(id) on delete set null,
  name text not null, -- the reward's name then
  kind text not null,
  quantity integer not null default 1 check (quantity >= 1),
  points integer not null, -- in total
  real_cost numeric(8,2), -- in total, as the catalog said then
  order_id uuid references orders(id) on delete set null,
  status text not null default 'used' check (status in ('used', 'returned')),
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  returned_at timestamptz
);
create index if not exists reward_redemptions_member_idx on reward_redemptions (member_id, created_at desc);
create index if not exists reward_redemptions_order_idx on reward_redemptions (order_id) where order_id is not null;
create index if not exists reward_redemptions_created_idx on reward_redemptions (created_at desc);
alter table reward_redemptions enable row level security;
grant select, insert, update on public.reward_redemptions to service_role;

-- ---------- owned perks ----------
create table if not exists member_perks (
  member_id uuid not null, -- no foreign key: see the top
  slot text not null,
  perk_key text not null,
  unlocked_at timestamptz not null default now(),
  expires_at timestamptz, -- null: for good
  primary key (member_id, slot, perk_key)
);
alter table member_perks enable row level security;
grant select, insert, update, delete on public.member_perks to service_role;

-- What they've picked to show, of what they own (null: the house default).
alter table members add column if not exists perk_sound text check (perk_sound is null or char_length(perk_sound) <= 24);
alter table members add column if not exists perk_frame text check (perk_frame is null or char_length(perk_frame) <= 24);
alter table members add column if not exists perk_name_color text check (perk_name_color is null or char_length(perk_name_color) <= 24);
alter table members add column if not exists perk_title text check (perk_title is null or char_length(perk_title) <= 24);

-- ---------- held back, and check-in tries ----------
create table if not exists points_held_back (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  reason text not null,
  wanted numeric(10,2) not null,
  given numeric(10,2) not null,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists points_held_back_member_idx on points_held_back (member_id, created_at desc);
alter table points_held_back enable row level security;
grant select, insert on public.points_held_back to service_role;

create table if not exists checkin_attempts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null,
  device text not null check (char_length(device) <= 80),
  paid boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists checkin_attempts_member_idx on checkin_attempts (member_id, at desc);
create index if not exists checkin_attempts_at_idx on checkin_attempts (at desc);
alter table checkin_attempts enable row level security;
grant select, insert on public.checkin_attempts to service_role;

-- A reward line on a register order carries its reward.
alter table order_items add column if not exists reward_id uuid references reward_catalog(id) on delete set null;

-- ---------- the business day ----------
-- Royale Cinema's day runs 4 AM to 4 AM Central (lib/visits.ts).
create or replace function public.rcl_business_date(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select ((p_at at time zone 'America/Chicago') - interval '4 hours')::date;
$$;
revoke execute on function public.rcl_business_date(timestamptz) from public, anon, authenticated;
grant execute on function public.rcl_business_date(timestamptz) to service_role;

-- When a business date starts.
create or replace function public.rcl_business_start(p_date date)
returns timestamptz
language sql
stable
as $$
  select (p_date + time '04:00') at time zone 'America/Chicago';
$$;
revoke execute on function public.rcl_business_start(date) from public, anon, authenticated;
grant execute on function public.rcl_business_start(date) to service_role;

-- ---------- earning ceilings ----------
-- Every change to members.points still goes through here. A positive
-- purchase, check-in or badge payment is held to the daily ceilings
-- (points_settings): what's over is logged in points_held_back and not paid.
-- Nothing else is ever capped (refunds, staff adjustments, merges, past
-- card purchases, spending). A payment capped to nothing writes no row.
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
  v_delta numeric := p_delta;
  s points_settings%rowtype;
  v_start timestamptz;
  v_today numeric;
begin
  if p_delta > 0 and p_reason in ('purchase', 'visit', 'badge') then
    select * into s from points_settings where id;
    if found then
      v_start := public.rcl_business_start(public.rcl_business_date(now()));
      -- One member's payments queue here, so two at once can't both fit under the cap.
      perform 1 from members where id = p_member for update;
      if p_reason in ('visit', 'badge') and s.bonus_daily_cap > 0 then
        select coalesce(sum(delta), 0) into v_today from points_ledger
         where member_id = p_member and reason in ('visit', 'badge') and delta > 0 and created_at >= v_start;
        v_delta := least(v_delta, greatest(0, s.bonus_daily_cap - v_today));
      end if;
      if s.earn_daily_cap > 0 then
        select coalesce(sum(delta), 0) into v_today from points_ledger
         where member_id = p_member and reason in ('purchase', 'visit', 'badge') and delta > 0 and created_at >= v_start;
        v_delta := least(v_delta, greatest(0, s.earn_daily_cap - v_today));
      end if;
      if v_delta < p_delta then
        insert into points_held_back (member_id, reason, wanted, given, order_id)
        values (p_member, p_reason, p_delta, v_delta, p_order);
      end if;
      if v_delta <= 0 then
        select points into new_balance from members where id = p_member;
        if new_balance is null then
          raise exception 'member % not found', p_member;
        end if;
        return new_balance;
      end if;
    end if;
  end if;

  update members set points = points + v_delta where id = p_member returning points into new_balance;
  if new_balance is null then
    raise exception 'member % not found', p_member;
  end if;
  insert into points_ledger (member_id, delta, balance_after, reason, order_id, booking_id, note, created_by)
  values (p_member, v_delta, new_balance, p_reason, p_order, p_booking, p_note, p_by);
  return new_balance;
end;
$$;
revoke execute on function public.apply_member_points(uuid, numeric, text, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_member_points(uuid, numeric, text, uuid, uuid, text, uuid) to service_role;

-- ---------- lifetime earned and spent ----------
-- Spending never lowers what's earned. For a sale or booking: once it's
-- refunded in full (nothing held from it any more) it counts for neither;
-- otherwise its 'redeem' rows are spent and the rest is earned. Anything
-- not tied to a sale: 'redeem' is spent (perks), everything else earned.
create or replace view member_points_totals as
with tied as (
  select member_id, coalesce(order_id, booking_id) as ref,
         sum(delta) as net,
         -sum(delta) filter (where reason = 'redeem') as spent,
         bool_or(reason = 'refund') as refunded
    from points_ledger
   where order_id is not null or booking_id is not null
   group by member_id, coalesce(order_id, booking_id)
), per_ref as (
  select member_id,
         case when refunded and net = 0 then 0 else net + coalesce(spent, 0) end as earned,
         case when refunded and net = 0 then 0 else coalesce(spent, 0) end as spent
    from tied
), loose as (
  select member_id,
         coalesce(sum(delta) filter (where reason <> 'redeem'), 0) as earned,
         coalesce(-sum(delta) filter (where reason = 'redeem'), 0) as spent
    from points_ledger
   where order_id is null and booking_id is null
   group by member_id
)
select member_id, sum(earned) as earned, sum(spent) as spent
  from (select * from per_ref union all select * from loose) x
 group by member_id;
revoke all on member_points_totals from public, anon, authenticated;
grant select on public.member_points_totals to service_role;

-- ---------- how many a member has had ----------
-- Of one reward (or every good, p_reward null) since the business day or
-- month started: counted from redemptions still standing.
create or replace function public.reward_count_since(p_member uuid, p_reward uuid, p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)::int
    from reward_redemptions
   where member_id = p_member and status = 'used' and created_at >= p_since
     and (case when p_reward is null then kind = 'good' else reward_id = p_reward end);
$$;
revoke execute on function public.reward_count_since(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reward_count_since(uuid, uuid, timestamptz) to service_role;

-- Why a member can't have `p_qty` more of a reward now (null: they can).
-- p_pending: the same reward's lines already on their order, and
-- p_pending_goods: all goods already on it, so the order's lines count too.
create or replace function public.reward_limit_problem(p_member uuid, p_reward uuid, p_qty integer default 1, p_pending integer default 0, p_pending_goods integer default 0)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r reward_catalog%rowtype;
  s points_settings%rowtype;
  v_day timestamptz := public.rcl_business_start(public.rcl_business_date(now()));
  v_month timestamptz := public.rcl_business_start(date_trunc('month', public.rcl_business_date(now()))::date);
begin
  select * into r from reward_catalog where id = p_reward;
  if not found or not r.active then return 'That reward isn''t available right now.'; end if;
  if r.kind = 'perk' and r.perk_slot = 'mobile' then return 'Coming soon.'; end if;
  if r.stock is not null and r.stock < p_qty + p_pending then return 'All gone for now.'; end if;
  if r.daily_limit is not null and public.reward_count_since(p_member, p_reward, v_day) + p_pending + p_qty > r.daily_limit then
    return format('%s a day, and that''s today''s.', r.daily_limit);
  end if;
  if r.monthly_limit is not null and public.reward_count_since(p_member, p_reward, v_month) + p_pending + p_qty > r.monthly_limit then
    return format('%s a month, and that''s this month''s.', r.monthly_limit);
  end if;
  if r.kind = 'good' then
    select * into s from points_settings where id;
    if found and s.goods_daily_limit > 0 and public.reward_count_since(p_member, null, v_day) + p_pending_goods + p_qty > s.goods_daily_limit then
      return format('%s rewards a day, and that''s today''s.', s.goods_daily_limit);
    end if;
    if found and s.goods_monthly_limit > 0 and public.reward_count_since(p_member, null, v_month) + p_pending_goods + p_qty > s.goods_monthly_limit then
      return format('%s rewards a month, and that''s this month''s.', s.goods_monthly_limit);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.reward_limit_problem(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reward_limit_problem(uuid, uuid, integer, integer, integer) to service_role;

-- ---------- unlocking a perk ----------
-- From the customer screen (the member taps Use) or their account. With
-- the member's row locked: it must be an active perk they can afford, within
-- its limits; points come off as one 'redeem' row ("Reward: Neon sign"),
-- the perk is theirs (a timed one runs from now, or from when the one they
-- have runs out), and it becomes what that slot shows. A perk they already
-- own for good comes back 'owned' and costs nothing.
-- Returns {status: ok|owned|short|limit|not_found, balance, expires_at, problem}.
create or replace function public.unlock_reward_perk(p_member uuid, p_reward uuid, p_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r reward_catalog%rowtype;
  v_bal numeric;
  v_have member_perks%rowtype;
  v_problem text;
  v_exp timestamptz;
begin
  select points into v_bal from members where id = p_member and erased_at is null for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into r from reward_catalog where id = p_reward and kind = 'perk' for update;
  if not found then return jsonb_build_object('status', 'not_found', 'balance', v_bal); end if;

  select * into v_have from member_perks where member_id = p_member and slot = r.perk_slot and perk_key = r.perk_key;
  if found and v_have.expires_at is null then
    return jsonb_build_object('status', 'owned', 'balance', v_bal);
  end if;
  v_problem := public.reward_limit_problem(p_member, p_reward, 1, 0, 0);
  if v_problem is not null then
    return jsonb_build_object('status', 'limit', 'balance', v_bal, 'problem', v_problem);
  end if;
  if v_bal < r.points then
    return jsonb_build_object('status', 'short', 'balance', v_bal);
  end if;

  v_bal := public.apply_member_points(p_member, -r.points, 'redeem', null, null, 'Reward: ' || r.name, p_by);
  insert into reward_redemptions (member_id, reward_id, name, kind, quantity, points, real_cost, created_by)
  values (p_member, r.id, r.name, 'perk', 1, r.points, r.real_cost, p_by);
  if r.stock is not null then update reward_catalog set stock = greatest(0, stock - 1) where id = r.id; end if;

  if r.perk_days is null then
    v_exp := null;
  else
    v_exp := greatest(now(), coalesce(v_have.expires_at, now())) + make_interval(days => r.perk_days);
  end if;
  insert into member_perks (member_id, slot, perk_key, unlocked_at, expires_at)
  values (p_member, r.perk_slot, r.perk_key, now(), v_exp)
  on conflict (member_id, slot, perk_key) do update set expires_at = excluded.expires_at;

  -- Show it now.
  if r.perk_slot = 'sound' then update members set perk_sound = r.perk_key where id = p_member;
  elsif r.perk_slot = 'entrance' then update members set flair_effect = r.perk_key where id = p_member;
  elsif r.perk_slot = 'frame' then update members set perk_frame = r.perk_key where id = p_member;
  elsif r.perk_slot = 'name_color' then update members set perk_name_color = r.perk_key where id = p_member;
  elsif r.perk_slot = 'title' then update members set perk_title = r.perk_key where id = p_member;
  end if;
  return jsonb_build_object('status', 'ok', 'balance', v_bal, 'expires_at', v_exp);
end;
$$;
revoke execute on function public.unlock_reward_perk(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.unlock_reward_perk(uuid, uuid, uuid) to service_role;

-- ---------- a timed perk that ran out ----------
-- Whatever a member shows that they no longer own goes back to the house
-- default. Paid entrances are the ones in the catalog (p_paid_entrances,
-- from src/lib/rewards.ts); the free ones are everyone's.
create or replace function public.sweep_member_perks(p_member uuid, p_paid_entrances text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m members%rowtype;
  owns text[];
begin
  select * into m from members where id = p_member;
  if not found then return; end if;
  select coalesce(array_agg(slot || ':' || perk_key), '{}') into owns
    from member_perks where member_id = p_member and (expires_at is null or expires_at > now());
  if m.perk_sound is not null and not ('sound:' || m.perk_sound) = any(owns) then update members set perk_sound = null where id = p_member; end if;
  if m.perk_frame is not null and not ('frame:' || m.perk_frame) = any(owns) then update members set perk_frame = null where id = p_member; end if;
  if m.perk_name_color is not null and not ('name_color:' || m.perk_name_color) = any(owns) then update members set perk_name_color = null where id = p_member; end if;
  if m.perk_title is not null and not ('title:' || m.perk_title) = any(owns) then update members set perk_title = null where id = p_member; end if;
  if m.flair_effect = any(p_paid_entrances) and not ('entrance:' || m.flair_effect) = any(owns) then
    update members set flair_effect = 'classic' where id = p_member;
  end if;
end;
$$;
revoke execute on function public.sweep_member_perks(uuid, text[]) from public, anon, authenticated;
grant execute on function public.sweep_member_perks(uuid, text[]) to service_role;

-- ---------- goods on a sale ----------
-- Called once the sale is saved, for the reward lines on it
-- (p_items: [{reward_id, quantity}]). With the member's row locked, each
-- is paid for with a 'redeem' row tied to the order ("Reward: Personal
-- popcorn (order #1234)"), a redemption is logged and stock comes down.
-- Limits were checked as each went on the order; here only the balance
-- counts, since the guest already has it: one they can't cover is left
-- unpaid and listed in 'short' for a manager. p_discount_points: the $5
-- off's points on this sale (already taken by the register), logged as a
-- redemption of the catalog's discount row so the economy counts it.
-- A second call for the same order does nothing.
create or replace function public.redeem_order_rewards(p_member uuid, p_order uuid, p_items jsonb, p_discount_points integer default 0, p_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  r reward_catalog%rowtype;
  q integer;
  pts integer;
  v_bal numeric;
  v_num bigint;
  short jsonb := '[]'::jsonb;
  used integer := 0;
begin
  if p_member is null or p_order is null then return jsonb_build_object('status', 'none'); end if;
  perform 1 from orders where id = p_order for update;
  if exists (select 1 from reward_redemptions where order_id = p_order) then
    return jsonb_build_object('status', 'done');
  end if;
  select points into v_bal from members where id = p_member for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select order_number into v_num from orders where id = p_order;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    q := greatest(1, least(20, coalesce((it->>'quantity')::int, 1)));
    select * into r from reward_catalog where id = (it->>'reward_id')::uuid and kind = 'good' for update;
    if not found then
      short := short || jsonb_build_object('reward_id', it->>'reward_id', 'why', 'not_found');
      continue;
    end if;
    pts := r.points * q;
    if v_bal < pts then
      short := short || jsonb_build_object('reward_id', r.id, 'name', r.name, 'points', pts, 'balance', v_bal, 'why', 'short');
      continue;
    end if;
    v_bal := public.apply_member_points(p_member, -pts, 'redeem', p_order, null,
      'Reward: ' || r.name || case when q > 1 then ' ×' || q else '' end || coalesce(' (order #' || v_num || ')', ''), p_by);
    insert into reward_redemptions (member_id, reward_id, name, kind, quantity, points, real_cost, order_id, created_by)
    values (p_member, r.id, r.name, 'good', q, pts, r.real_cost * q, p_order, p_by);
    if r.stock is not null then update reward_catalog set stock = greatest(0, stock - q) where id = r.id; end if;
    used := used + pts;
  end loop;

  if coalesce(p_discount_points, 0) > 0 then
    insert into reward_redemptions (member_id, reward_id, name, kind, quantity, points, real_cost, order_id, created_by)
    select p_member, c.id, coalesce(c.name, '$5 off'), 'discount', 1, p_discount_points, coalesce(c.real_cost, 5), p_order, p_by
      from (select 1) one left join reward_catalog c on c.kind = 'discount';
  end if;
  return jsonb_build_object('status', 'ok', 'used', used, 'balance', v_bal, 'short', short);
end;
$$;
revoke execute on function public.redeem_order_rewards(uuid, uuid, jsonb, integer, uuid) from public, anon, authenticated;
grant execute on function public.redeem_order_rewards(uuid, uuid, jsonb, integer, uuid) to service_role;

-- ---------- a refund gives them back ----------
-- However an order's points are taken back (a refund, a card match undone),
-- once nothing is held from it any more its redemptions are 'returned' and
-- their stock goes back on the shelf.
create or replace function public.points_ledger_return_rewards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net numeric;
  rr record;
begin
  if new.reason <> 'refund' or new.order_id is null then return null; end if;
  select coalesce(sum(delta), 0) into v_net from points_ledger
   where order_id = new.order_id and member_id = new.member_id and reason in ('purchase', 'redeem', 'refund', 'adjustment');
  if v_net <> 0 then return null; end if;
  for rr in update reward_redemptions set status = 'returned', returned_at = now()
             where order_id = new.order_id and member_id = new.member_id and status = 'used'
           returning reward_id, quantity, kind loop
    if rr.kind = 'good' and rr.reward_id is not null then
      update reward_catalog set stock = stock + rr.quantity where id = rr.reward_id and stock is not null;
    end if;
  end loop;
  return null;
end;
$$;
drop trigger if exists points_ledger_return_rewards on points_ledger;
create trigger points_ledger_return_rewards after insert on points_ledger
  for each row execute function public.points_ledger_return_rewards();
revoke execute on function public.points_ledger_return_rewards() from public, anon, authenticated;

-- ---------- merges and removals ----------
create or replace function public.rewards_member_merged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update reward_redemptions set member_id = new.keep_id where member_id = new.dropped_id;
  update points_held_back set member_id = new.keep_id where member_id = new.dropped_id;
  update checkin_attempts set member_id = new.keep_id where member_id = new.dropped_id;
  -- Their perks join the kept account's (the longer one wins).
  insert into member_perks (member_id, slot, perk_key, unlocked_at, expires_at)
  select new.keep_id, slot, perk_key, unlocked_at, expires_at from member_perks where member_id = new.dropped_id
  on conflict (member_id, slot, perk_key) do update
    set expires_at = case when member_perks.expires_at is null or excluded.expires_at is null then null
                          else greatest(member_perks.expires_at, excluded.expires_at) end;
  delete from member_perks where member_id = new.dropped_id;
  return null;
end;
$$;
drop trigger if exists rewards_member_merged on member_merges;
create trigger rewards_member_merged after insert on member_merges
  for each row execute function public.rewards_member_merged();
revoke execute on function public.rewards_member_merged() from public, anon, authenticated;

create or replace function public.members_delete_rewards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from member_perks where member_id = old.id;
  delete from checkin_attempts where member_id = old.id;
  delete from points_held_back where member_id = old.id;
  delete from reward_redemptions where member_id = old.id;
  return old;
end;
$$;
drop trigger if exists members_delete_rewards on members;
create trigger members_delete_rewards after delete on members
  for each row execute function public.members_delete_rewards();
revoke execute on function public.members_delete_rewards() from public, anon, authenticated;

-- ---------- the watch list ----------
-- Members whose earning or spending looks unusual over the last p_days.
-- One row per member and rule, with a plain reason. The thresholds are
-- here, in one place.
create or replace function public.points_watch_list(p_days integer default 30)
returns table (member_id uuid, rule text, reason text, weight numeric, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with since as (select now() - make_interval(days => greatest(1, least(p_days, 365))) as t),
  -- Many small orders in one business day: 4 or more under $5 each.
  small as (
    select o.member_id, public.rcl_business_date(o.completed_at) as d, count(*) as n, max(o.completed_at) as last_at
      from orders o, since
     where o.status = 'completed' and o.member_id is not null and o.completed_at >= since.t and o.total < 5
     group by o.member_id, public.rcl_business_date(o.completed_at)
    having count(*) >= 4
  ),
  -- Points far above what they spent: check-in, badge and hand-given
  -- points of 300 or more, and over 3 times their purchase points. (A new
  -- member's first-week badges come to about 155, so they don't show.)
  earn as (
    select l.member_id,
           coalesce(sum(l.delta) filter (where l.reason = 'purchase' and l.delta > 0), 0) as bought,
           coalesce(sum(l.delta) filter (where l.reason in ('visit', 'badge', 'adjustment') and l.delta > 0), 0) as bonus,
           max(l.created_at) as last_at
      from points_ledger l, since
     where l.created_at >= since.t
     group by l.member_id
  ),
  -- Check-in tries from 2 or more screens or doors in one business day, or
  -- 4 or more tries in one day.
  tries as (
    select a.member_id, public.rcl_business_date(a.at) as d, count(distinct a.device) as devices, count(*) as n, max(a.at) as last_at
      from checkin_attempts a, since
     where a.at >= since.t
     group by a.member_id, public.rcl_business_date(a.at)
    having count(distinct a.device) >= 2 or count(*) >= 4
  ),
  -- A reward bought within an hour of earning the points that paid for it
  -- (they couldn't afford it before).
  quick as (
    select r.member_id, count(*) as n, max(r.created_at) as last_at
      from points_ledger r, since
     where r.reason = 'redeem' and r.created_at >= since.t
       and exists (
         select 1 from points_ledger e
          where e.member_id = r.member_id and e.delta > 0 and e.reason in ('purchase', 'visit', 'badge', 'adjustment', 'welcome_bonus', 'backfill')
            and e.created_at <= r.created_at and e.created_at > r.created_at - interval '1 hour'
            and e.balance_after - e.delta < -r.delta
            and (r.order_id is null or e.order_id is distinct from r.order_id)
       )
     group by r.member_id
    having count(*) >= 2
  ),
  -- Points paid by a card match (nobody on the sale) adding up: 5 or more
  -- sales, or 200 or more points.
  cards as (
    select c.credited_member_id as member_id, count(*) as n, coalesce(sum(l.delta), 0) as pts, max(c.credited_at) as last_at
      from card_payments c
      join since on true
      left join points_ledger l on l.member_id = c.credited_member_id and l.reason = 'purchase'
        and ((c.order_id is not null and l.order_id = c.order_id) or (c.booking_id is not null and l.booking_id = c.booking_id))
     where c.credited_how = 'card' and c.undone_at is null and c.credited_at >= since.t
     group by c.credited_member_id
    having count(*) >= 5 or coalesce(sum(l.delta), 0) >= 200
  ),
  -- The daily ceiling kept points back.
  held as (
    select h.member_id, count(*) as n, sum(h.wanted - h.given) as pts, max(h.created_at) as last_at
      from points_held_back h, since
     where h.created_at >= since.t
     group by h.member_id
  )
  select member_id, 'small_orders', format('%s orders under $5 on %s', n, to_char(d, 'Mon FMDD')), n::numeric, last_at from small
  union all
  select member_id, 'points_over_spend', format('%s bonus points vs %s from purchases', round(bonus), round(bought)), bonus, last_at
    from earn where bonus >= 300 and bonus > 3 * bought
  union all
  select member_id, 'many_devices',
         case when devices >= 2 then format('Checked in from %s different screens or doors on %s', devices, to_char(d, 'Mon FMDD'))
              else format('%s check-in tries on %s', n, to_char(d, 'Mon FMDD')) end,
         greatest(devices, n)::numeric, last_at from tries
  union all
  select member_id, 'quick_redeem', format('%s rewards bought within an hour of earning the points', n), n::numeric, last_at from quick
  union all
  select member_id, 'card_points', format('%s points from %s card-matched sales', round(pts), n), pts, last_at from cards
  union all
  select member_id, 'held_back', format('Hit the daily earning limit %s time%s (%s points held back)', n, case when n = 1 then '' else 's' end, round(pts)), pts, last_at from held;
$$;
revoke execute on function public.points_watch_list(integer) from public, anon, authenticated;
grant execute on function public.points_watch_list(integer) to service_role;

-- ---------- the starter catalog ----------
-- Priced at about 5¢ a point (100 points = $5): a reward costs what it
-- sells for, at that rate. real_cost is what it costs Royale Cinema (an
-- estimate where nothing better was on file). All editable in Back office.
insert into reward_catalog (name, description, kind, perk_slot, perk_key, perk_days, points, real_cost, is_alcohol, daily_limit, monthly_limit, sort)
select v.* from (values
  ('Personal popcorn', 'A personal bag, fresh from the popper.', 'good', null, null, null::int, 40, 0.35::numeric, false, 2, null::int, 10),
  ('Canned soda', 'Any can from the cooler.', 'good', null, null, null, 40, 0.60, false, 2, null, 20),
  ('Candy', 'Any box of movie candy.', 'good', null, null, null, 80, 1.50, false, 2, null, 30),
  ('$5 off', '$5 off your order.', 'discount', null, null, null, 100, 5.00, false, 1, null, 35),
  ('Well drink or canned beer', 'A well drink or a canned beer. 21+, ID checked.', 'good', null, null, null, 100, 1.05, true, 1, null, 40),
  ('Movie ticket', 'One standard movie ticket.', 'good', null, null, null, 160, 2.00, false, 1, 4, 50),
  ('Free booth hour', 'An hour in one of the VHS lounge booths.', 'good', null, null, null, 200, 0.00, false, 1, 2, 60),
  ('Sound: Arcade coin', 'Your check-in plays a bright arcade coin.', 'perk', 'sound', 'coin', null, 50, 0.00, false, null, null, 100),
  ('Sound: Projector roll', 'A film projector clatters to life when you check in.', 'perk', 'sound', 'projector', null, 50, 0.00, false, null, null, 110),
  ('Sound: Theater organ', 'A little organ flourish, like the old movie palaces.', 'perk', 'sound', 'organ', null, 75, 0.00, false, null, null, 120),
  ('Sound: Sci-fi warp', 'Your check-in warps in from outer space.', 'perk', 'sound', 'warp', null, 75, 0.00, false, null, null, 130),
  ('Sound: Drumroll', 'A drumroll and a cymbal for your big entrance.', 'perk', 'sound', 'drumroll', null, 75, 0.00, false, null, null, 140),
  ('Entrance: Neon sign', 'Your name buzzes on in neon.', 'perk', 'entrance', 'neon', null, 150, 0.00, false, null, null, 200),
  ('Entrance: VHS static', 'Static, tracking lines, then PLAY.', 'perk', 'entrance', 'vhs', null, 150, 0.00, false, null, null, 210),
  ('Entrance: Film reel', 'A film leader counts down 3, 2, 1.', 'perk', 'entrance', 'reel', null, 150, 0.00, false, null, null, 220),
  ('Entrance: Retro arcade', 'PLAYER 1 READY, in pixels.', 'perk', 'entrance', 'arcade', null, 150, 0.00, false, null, null, 230),
  ('Entrance: Popcorn rain', 'It rains popcorn.', 'perk', 'entrance', 'popcorn', null, 150, 0.00, false, null, null, 240),
  ('Card frame: Gold marquee', 'Marquee lights around your card.', 'perk', 'frame', 'marquee', null, 100, 0.00, false, null, null, 300),
  ('Card frame: Film strip', 'Sprocket holes down both sides.', 'perk', 'frame', 'filmstrip', null, 100, 0.00, false, null, null, 310),
  ('Card frame: Neon tube', 'A glowing neon edge in your color.', 'perk', 'frame', 'neon', null, 100, 0.00, false, null, null, 320),
  ('Card frame: Ticket stub', 'Your card as a torn ticket stub.', 'perk', 'frame', 'ticket', null, 100, 0.00, false, null, null, 330),
  ('Name color: Gold shimmer', 'Your name in shimmering gold on your card.', 'perk', 'name_color', 'gold', null, 60, 0.00, false, null, null, 400),
  ('Name color: Rainbow', 'Your name in a slow rainbow.', 'perk', 'name_color', 'rainbow', null, 80, 0.00, false, null, null, 410),
  ('Name color: Neon pink', 'Your name glows hot pink.', 'perk', 'name_color', 'neonpink', null, 60, 0.00, false, null, null, 420),
  ('Title: Popcorn Royalty', 'A title under your name, for 30 days.', 'perk', 'title', 'popcorn_royalty', 30, 40, 0.00, false, null, null, 500),
  ('Title: Front Row Regular', 'A title under your name, for good.', 'perk', 'title', 'front_row', null, 120, 0.00, false, null, null, 510),
  ('Title: Midnight Movie Monster', 'A title under your name, for good.', 'perk', 'title', 'midnight_monster', null, 120, 0.00, false, null, null, 520),
  ('Title: Certified Cinephile', 'A title under your name, for good.', 'perk', 'title', 'cinephile', null, 150, 0.00, false, null, null, 530),
  ('Order-up sound', 'Your own sound when a phone order is ready. Coming with mobile ordering.', 'perk', 'mobile', 'order_up', null, 100, 0.00, false, null, null, 900)
) as v(name, description, kind, perk_slot, perk_key, perk_days, points, real_cost, is_alcohol, daily_limit, monthly_limit, sort)
where not exists (select 1 from reward_catalog);

-- Mobile ordering isn't built yet: its perk stays off the Spend points list
-- (unlocking it is refused anyway) until it is.
update reward_catalog set active = false where perk_slot = 'mobile' and active;
