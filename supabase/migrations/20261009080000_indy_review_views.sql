-- Back office > Members > Indy history review: read-only views over the
-- Indy staging tables (20261009070000_indy_history_staging.sql).
--
-- Nothing here grants points or changes a member. The views only add up
-- what's staged so the owners can look before anything is distributed.
--
-- The proposed points use the basis Andrew picked (Oct 9, 2026): past
-- purchases, tax included, staff included, 1 point per $1, rounded down per
-- member. A purchase is an Indy order line in state 'paid' of type item,
-- ticket, misc-item or booking-fee: price + tax - discount. Tips,
-- memberships, gift cards, voucher purchases, donations and credit
-- adjustments don't count.
--
-- Customer details: server-only. security_invoker so RLS on the staging
-- tables applies to whoever asks; only the service role is granted.
--
-- Safe to run twice.

create or replace view public.indy_review_purchases with (security_invoker = true) as
select i.row_no, i.order_id, i.user_id, i.paid_at_local,
  coalesce(i.price_cents, 0) + coalesce(i.tax_cents, 0) - coalesce(i.discount_cents, 0) as amount_cents,
  coalesce(i.tax_cents, 0) as tax_cents
from public.indy_order_items i
where i.state = 'paid' and i.type in ('item', 'ticket', 'misc-item', 'booking-fee');

create or replace view public.indy_review_members with (security_invoker = true) as
with p as (
  select m.member_id,
    array_agg(distinct m.indy_user_id) as indy_user_ids,
    string_agg(distinct m.match_kind, ', ') as match_kinds,
    count(distinct x.order_id)::int as orders,
    coalesce(sum(x.amount_cents), 0)::bigint as purchase_cents,
    coalesce(sum(x.tax_cents), 0)::bigint as tax_cents,
    min(x.paid_at_local) as first_at,
    max(x.paid_at_local) as last_at
  from public.indy_user_matches m
  join public.indy_review_purchases x on x.user_id = m.indy_user_id
  group by m.member_id
),
pts as (
  select email_lc, sum(amount_remaining) as remaining from public.indy_user_points
  where state = 'valid' and email_lc is not null group by email_lc
),
live as (
  select id, phone_digits, nullif(lower(trim(name)), '') as name_lc from public.members where erased_at is null
),
names as (select name_lc from live where name_lc is not null group by name_lc having count(*) > 1),
iu as (
  select m.member_id,
    bool_or(coalesce(u.raw ->> 'employee', '') = 'true') as indy_employee,
    coalesce(sum(u.points_preloaded), 0) as indy_preloaded,
    coalesce(sum(pts.remaining), 0) as indy_remaining,
    bool_or(o.id is not null) as phone_other_member
  from public.indy_user_matches m
  left join public.indy_users u on u.id = m.indy_user_id
  left join pts on pts.email_lc = u.email_lc
  left join lateral (select l.id from live l where l.phone_digits = u.phone_digits and l.id <> m.member_id limit 1) o on true
  group by m.member_id
),
staff as (
  select distinct mem.id as member_id from public.members mem join public.employees e on e.auth_user_id = mem.auth_user_id and e.active
),
fortis as (select member_id, sum(points)::int as points from public.fortis_backfill_grants group by member_id)
select p.member_id, mem.name, mem.email, p.indy_user_ids, p.match_kinds, p.orders, p.purchase_cents, p.tax_cents,
  p.first_at, p.last_at,
  floor(greatest(p.purchase_cents, 0) / 100.0)::int as proposed_points,
  iu.indy_remaining, iu.indy_preloaded,
  coalesce(mem.points, 0) as rcl_points,
  coalesce(iu.indy_employee, false) as indy_employee,
  (staff.member_id is not null) as rcl_staff,
  fortis.points as fortis_points,
  (names.name_lc is not null) as same_name_other_member,
  coalesce(iu.phone_other_member, false) as phone_other_member
from p
join public.members mem on mem.id = p.member_id
left join iu on iu.member_id = p.member_id
left join staff on staff.member_id = p.member_id
left join fortis on fortis.member_id = p.member_id
left join names on names.name_lc = nullif(lower(trim(mem.name)), '');

-- Indy buyers with no member match, largest spend first.
create or replace view public.indy_review_unmatched with (security_invoker = true) as
select x.user_id as indy_user_id,
  coalesce(nullif(trim(concat_ws(' ', u.raw ->> 'first_name', u.raw ->> 'last_name')), ''), max(i.raw ->> 'user_name')) as name,
  coalesce(u.email_lc, max(i.email_lc)) as email_lc,
  (u.phone_digits is not null) as has_phone,
  count(distinct x.order_id)::int as orders,
  sum(x.amount_cents)::bigint as purchase_cents,
  min(x.paid_at_local) as first_at,
  max(x.paid_at_local) as last_at
from public.indy_review_purchases x
join public.indy_order_items i on i.row_no = x.row_no
left join public.indy_users u on u.id = x.user_id
where x.user_id is not null and x.user_id not in (select indy_user_id from public.indy_user_matches)
group by x.user_id, u.raw, u.email_lc, u.phone_digits;

revoke all on public.indy_review_purchases from anon, authenticated;
revoke all on public.indy_review_members from anon, authenticated;
revoke all on public.indy_review_unmatched from anon, authenticated;
grant select on public.indy_review_purchases to service_role;
grant select on public.indy_review_members to service_role;
grant select on public.indy_review_unmatched to service_role;
