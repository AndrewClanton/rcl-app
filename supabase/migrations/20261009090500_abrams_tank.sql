-- A joke on Spend points (10/9): an M1 Abrams main battle tank, priced at
-- what one really costs, in its own "Big ticket" section. Display-only:
-- it can never be redeemed.
--
-- The math: an M1A2 SEPv3 runs about $10 million a tank (the commonly
-- cited unit cost; recent contracts run higher). Rewards are worth
-- 100 points = $5, so 20 points a dollar: $10,000,000 x 20 = 200,000,000
-- points. Points are earned at 1 per $1 spent, so that's about
-- $200 million in purchases.
--
-- Why it can't be redeemed, server side (not just balances): stock is 0,
-- and every redeem path checks stock (reward_limit_problem returns "All
-- gone for now."; redeem_order_points refuses it under the row lock). The
-- points check below only lets a price over 100,000 exist on a good with
-- stock 0, so it can't be restocked without being repriced first.
--
-- Additive: widens two checks and inserts one row. Safe to run more than once.

alter table public.reward_catalog drop constraint if exists reward_catalog_points_check;
alter table public.reward_catalog add constraint reward_catalog_points_check
  check (points between 1 and 100000
         or (kind = 'good' and stock = 0 and points between 1 and 200000000));

alter table public.reward_catalog drop constraint if exists reward_catalog_section_check;
alter table public.reward_catalog add constraint reward_catalog_section_check
  check (section is null or (kind = 'good' and section in ('food', 'tickets', 'big')));

insert into public.reward_catalog (name, description, kind, section, points, real_cost, is_alcohol, stock, active, sort)
select 'M1 Abrams main battle tank',
       'Approximately $10 million. 200 million points, or about $200 million in popcorn. Delivery not included.',
       'good', 'big', 200000000, null, false, 0, true, 9999
where not exists (select 1 from public.reward_catalog where name = 'M1 Abrams main battle tank');
