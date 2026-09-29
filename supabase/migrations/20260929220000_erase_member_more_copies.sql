-- Removing a member's personal info, second pass (see /data-deletion and
-- src/lib/member-erase.ts). Everything the first version
-- (20260925000000) cleared is still cleared, plus the copies it missed:
--
--   - private events booked under their email: the event's own name too
--     ("Sarah's 40th"), not just the organizer's name and email
--   - custom item text typed at the register ("Cake for Sarah"), and tab or
--     order names, on their orders. A closed order with no member on it
--     whose tab was named exactly their full name counts as theirs too.
--   - gift memberships they bought (buyer name, email, their note), and the
--     note on any gift they received
--   - their profile quote (members.tagline), once that column exists
--   - check-in visits: the rows stay so daily visit counts stay right, but
--     the streak and points on them go (points history is deleted anyway)
--   - unused streak rewards (a used one stays, anonymous, as a count)
--   - a gifted Insiders+ end date
--
-- Stripe is handled by the app, not here: it cancels billing, takes the
-- saved card off, and blanks the name, email and phone on their Stripe
-- customer. The customer itself is kept, because its payments are part of
-- the tax records. This function hands back the Stripe customers behind
-- their bar-tab cards so the app can blank those too.
--
-- Every removal is logged in member_erasures: the day the person asked (as
-- staff entered it), when it was done and by whom, so the 30-day promise
-- on /data-deletion can be checked.
--
-- Additive and safe to run more than once. Nothing here removes data by
-- itself; it only changes what the function does the next time staff press
-- Remove.

-- ---------- the log ----------
create table if not exists member_erasures (
  id uuid primary key default gen_random_uuid(),
  -- The nameless placeholder row the member became.
  member_id uuid references members(id) on delete set null,
  -- When they asked (from the staff member doing it). Null if not given.
  requested_on date,
  erased_at timestamptz not null default now(),
  erased_by uuid references employees(id) on delete set null,
  -- What was cleared, as counts (the function's own summary).
  cleared jsonb not null default '{}'::jsonb
);
create index if not exists member_erasures_erased_at_idx on member_erasures (erased_at desc);
create index if not exists member_erasures_member_idx on member_erasures (member_id);

-- Server-only, like the rest: RLS on, no client policies.
alter table member_erasures enable row level security;

-- Anyone removed before this log existed gets a row too (no request date).
insert into member_erasures (member_id, erased_at, erased_by)
select m.id, m.erased_at, m.erased_by
from members m
where m.erased_at is not null
  and not exists (select 1 from member_erasures e where e.member_id = m.id);

-- ---------- the function ----------
create or replace function public.erase_member_personal_info(p_member uuid, p_by uuid, p_requested_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m members%rowtype;
  full_name text;
  their_orders uuid[];
  tab_customers text[];
  n_orders int := 0;
  n_items int := 0;
  n_bookings int := 0;
  n_booths int := 0;
  n_events int := 0;
  n_gifts_bought int := 0;
  n_gifts_received int := 0;
  n_visits int := 0;
  n_rewards int := 0;
  n_legacy int := 0;
  n_points int := 0;
  result jsonb;
begin
  select * into m from members where id = p_member for update;
  if not found then
    raise exception 'member % not found', p_member;
  end if;
  if m.erased_at is not null then
    return jsonb_build_object('already_erased', true);
  end if;

  -- Their orders: anything with them attached, plus a closed order (not an
  -- open tab someone may still be drinking on) whose tab or order name is
  -- exactly their full name. Only a name with at least two words counts;
  -- "Sam" alone could be anyone.
  full_name := lower(btrim(coalesce(m.name, '')));
  select coalesce(array_agg(o.id), '{}'), coalesce(array_agg(distinct o.tab_card_customer_id) filter (where o.tab_card_customer_id is not null), '{}')
  into their_orders, tab_customers
  from orders o
  where o.member_id = p_member
     or (full_name ~ '\S\s+\S'
         and o.status in ('completed', 'refunded', 'voided')
         and (lower(btrim(coalesce(o.order_name, ''))) = full_name or lower(btrim(coalesce(o.tab_name, ''))) = full_name));

  -- Their name on register tabs and held orders.
  update orders set order_name = null, tab_name = null
  where id = any(their_orders) and (order_name is not null or tab_name is not null);
  get diagnostics n_orders = row_count;

  -- Text typed in for a custom item on those orders. Menu items, tickets
  -- and event lines keep their names: those come from the menu and the
  -- schedule, not from the customer.
  update order_items set name = 'Custom item'
  where order_id = any(their_orders)
    and menu_item_id is null and screening_id is null and linked_event_id is null
    and name is distinct from 'Custom item';
  get diagnostics n_items = row_count;

  -- Name and email typed in at online checkout.
  update bookings set customer_name = null, customer_email = null
  where member_id = p_member or (m.email is not null and lower(customer_email) = lower(m.email));
  get diagnostics n_bookings = row_count;

  -- Booth reservations (name and email are required columns, so blanked).
  update booth_reservations set customer_name = 'Removed member', customer_email = '', customer_phone = null
  where member_id = p_member or (m.email is not null and lower(customer_email) = lower(m.email));
  get diagnostics n_booths = row_count;

  -- Private event requests are matched by email (they have no member link).
  -- The event's own name often carries theirs ("Sarah's 40th"), so it goes
  -- too; the date, room and money stay for the books.
  update events set organizer_name = null, organizer_email = '', event_name = 'Private event'
  where m.email is not null and lower(organizer_email) = lower(m.email);
  get diagnostics n_events = row_count;

  -- Gift memberships they paid for (buyer name and email are required
  -- columns, so blanked), and the personal note on any gift they got. The
  -- buyer of a gift they received is someone else, and keeps their receipt.
  if m.email is not null then
    update gift_memberships set buyer_name = 'Removed member', buyer_email = '', message = null
    where lower(buyer_email) = lower(m.email);
    get diagnostics n_gifts_bought = row_count;
  end if;
  update gift_memberships set message = null
  where recipient_member_id = p_member and message is not null;
  get diagnostics n_gifts_received = row_count;

  -- Tables and columns newer than some copies of the schema: only touched
  -- where they exist, so this runs on either.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'tagline') then
    execute 'update members set tagline = null where id = $1' using p_member;
  end if;
  -- Check-in visits stay (the day still had a visit), without the streak
  -- and points on them.
  if to_regclass('public.member_visits') is not null then
    execute 'update member_visits set streak = null, points_awarded = null where member_id = $1' using p_member;
    get diagnostics n_visits = row_count;
  end if;
  -- A streak reward they never used can't be used now. A used one stays as
  -- a count of what was given away.
  if to_regclass('public.member_rewards') is not null then
    execute 'delete from member_rewards where member_id = $1 and redeemed_at is null' using p_member;
    get diagnostics n_rewards = row_count;
  end if;

  -- The old-site copy, including any duplicate old accounts with the same
  -- email. Marked skipped and erased so a later re-pull can't bring it back.
  update legacy_accounts
  set email = null, username = null, first_name = null, last_name = null, phone = null,
      subscription_fortis_id = null, decision = 'skip', decided_by = p_by, decided_at = now(), erased_at = now()
  where (m.legacy_user_id is not null and legacy_user_id = m.legacy_user_id)
     or (m.email is not null and lower(email) = lower(m.email));
  get diagnostics n_legacy = row_count;

  -- Points and points history.
  delete from points_ledger where member_id = p_member;
  get diagnostics n_points = row_count;

  update members set
    name = 'Removed member',
    email = null,
    phone = null,
    avatar_url = null,
    auth_user_id = null,
    comp_notes = null,
    price_tier = null,
    price_tier_set_by = null,
    price_tier_set_at = null,
    stripe_customer_id = null,
    stripe_subscription_id = null,
    subscription_status = case when m.stripe_subscription_id is not null then 'canceled' else subscription_status end,
    tier = 'Insiders',
    monthly_member = false,
    points = 0,
    plus_gift_until = null,
    email_opt_in = false,
    erased_at = now(),
    erased_by = p_by
  where id = p_member;

  result := jsonb_build_object(
    'orders', n_orders, 'custom_items', n_items, 'bookings', n_bookings, 'booth_reservations', n_booths,
    'events', n_events, 'gifts_bought', n_gifts_bought, 'gift_notes', n_gifts_received,
    'visits', n_visits, 'rewards', n_rewards, 'old_site_rows', n_legacy, 'points_entries', n_points
  );

  insert into member_erasures (member_id, requested_on, erased_at, erased_by, cleared)
  values (p_member, p_requested_on, now(), p_by, result);

  -- Only for the app (blanking those Stripe customers); not logged.
  return result || jsonb_build_object('tab_card_customers', to_jsonb(tab_customers));
end;
$$;

-- The original two-argument form, kept so anything still calling it (an
-- older deploy, scripts/check-member-erase.mjs) gets the full removal, with
-- no request date.
create or replace function public.erase_member_personal_info(p_member uuid, p_by uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.erase_member_personal_info(p_member, p_by, null::date);
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.erase_member_personal_info(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.erase_member_personal_info(uuid, uuid, date) to service_role;
revoke execute on function public.erase_member_personal_info(uuid, uuid) from public, anon, authenticated;
grant execute on function public.erase_member_personal_info(uuid, uuid) to service_role;
