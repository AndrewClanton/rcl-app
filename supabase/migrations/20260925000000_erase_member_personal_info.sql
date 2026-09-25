-- Removing a member's personal info on request (see /data-deletion).
--
-- The members row stays as a nameless placeholder so purchase, ticket and
-- tax records keep a valid link; everything that identifies the person is
-- cleared, everywhere it was copied. The app cancels Stripe billing and
-- deletes the login before calling this, and deletes photo files after.

alter table members add column if not exists erased_at timestamptz;
alter table members add column if not exists erased_by uuid references employees(id) on delete set null;
alter table legacy_accounts add column if not exists erased_at timestamptz;

create or replace function public.erase_member_personal_info(p_member uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m members%rowtype;
  n_orders int;
  n_bookings int;
  n_booths int;
  n_events int;
  n_legacy int;
  n_points int;
begin
  select * into m from members where id = p_member for update;
  if not found then
    raise exception 'member % not found', p_member;
  end if;
  if m.erased_at is not null then
    return jsonb_build_object('already_erased', true);
  end if;

  -- Their name on register tabs and held orders.
  update orders set order_name = null, tab_name = null
  where member_id = p_member and (order_name is not null or tab_name is not null);
  get diagnostics n_orders = row_count;

  -- Name and email typed in at online checkout.
  update bookings set customer_name = null, customer_email = null
  where member_id = p_member or (m.email is not null and lower(customer_email) = lower(m.email));
  get diagnostics n_bookings = row_count;

  -- Booth reservations (name and email are required columns, so blanked).
  update booth_reservations set customer_name = 'Removed member', customer_email = '', customer_phone = null
  where member_id = p_member or (m.email is not null and lower(customer_email) = lower(m.email));
  get diagnostics n_booths = row_count;

  -- Private event requests are matched by email (they have no member link).
  update events set organizer_name = null, organizer_email = ''
  where m.email is not null and lower(organizer_email) = lower(m.email);
  get diagnostics n_events = row_count;

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
    email_opt_in = false,
    erased_at = now(),
    erased_by = p_by
  where id = p_member;

  return jsonb_build_object(
    'orders', n_orders, 'bookings', n_bookings, 'booth_reservations', n_booths,
    'events', n_events, 'old_site_rows', n_legacy, 'points_entries', n_points
  );
end;
$$;

revoke execute on function public.erase_member_personal_info(uuid, uuid) from public, anon, authenticated;
grant execute on function public.erase_member_personal_info(uuid, uuid) to service_role;
