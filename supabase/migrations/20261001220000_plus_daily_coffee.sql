-- Insiders+ daily coffee: one free black coffee or hot tea per business day
-- (4 a.m. to 4 a.m. Central) for a member with Insiders+ perks. How it
-- works is in src/lib/daily-perk.ts.
--
--   menu_items.daily_perk          the item can be the free coffee (ticked on
--                                  Back office -> Menu). Drip coffee and
--                                  Batch brew are ticked below.
--   orders.daily_perk_discount     what the free coffee took off the order
--                                  (its menu price; paid add-ons were still
--                                  charged). Its own line in Reports, like
--                                  tier_discount, monthly_discount and
--                                  redemption_discount.
--   orders.daily_perk_date         the business day the member used it on.
--                                  Null on an order without one, and on one
--                                  whose coffee couldn't count as that day's
--                                  (already used: the money given away is
--                                  still in daily_perk_discount).
--
-- One a day: a member can have only one completed order with a
-- daily_perk_date per business day (orders_daily_perk_once). A refunded or
-- voided order isn't 'completed', so refunding or voiding it frees that
-- day's coffee again, with nothing else to undo. Held orders and open tabs
-- never carry a date: it's set when the order is paid.
--
-- Merging duplicate members (merge_members) moves orders from one account to
-- the other. If both used their coffee the same day, the moved order keeps
-- its discount but stops counting as that day's (daily_perk_date goes null),
-- so the merge isn't stopped by the one-a-day rule.
--
-- Until this runs the register never offers the coffee (no item is ticked),
-- so it can be applied before or after the app update. Safe to run more
-- than once: the coffee items are ticked only when no item is ticked yet,
-- so it won't undo changes made on the Menu page.

alter table menu_items add column if not exists daily_perk boolean not null default false;

alter table orders add column if not exists daily_perk_discount numeric(10,2) not null default 0;
alter table orders add column if not exists daily_perk_date date;

create unique index if not exists orders_daily_perk_once
  on orders (member_id, daily_perk_date)
  where daily_perk_date is not null and status = 'completed';

create or replace function orders_daily_perk_follow_member() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (
    select 1 from orders o
     where o.member_id = new.member_id
       and o.daily_perk_date = new.daily_perk_date
       and o.status = 'completed'
       and o.id <> new.id
  ) then
    new.daily_perk_date := null;
  end if;
  return new;
end;
$$;

revoke all on function orders_daily_perk_follow_member() from public, anon, authenticated;

drop trigger if exists orders_daily_perk_follow_member on orders;
create trigger orders_daily_perk_follow_member
  before update of member_id on orders
  for each row
  when (new.daily_perk_date is not null and new.member_id is distinct from old.member_id)
  execute function orders_daily_perk_follow_member();

-- Today's black coffees, in the Caffe category (or under it).
do $$
declare
  n int;
begin
  if exists (select 1 from menu_items where daily_perk) then
    raise notice 'daily coffee items already chosen; left as they are';
    return;
  end if;
  update menu_items
     set daily_perk = true
   where lower(name) in ('drip coffee', 'batch brew')
     and category_id in (
       select id from menu_categories
        where key = 'caffe'
           or parent_id in (select id from menu_categories where key = 'caffe')
     );
  get diagnostics n = row_count;
  raise notice 'daily coffee items ticked: %', n;
end;
$$;
