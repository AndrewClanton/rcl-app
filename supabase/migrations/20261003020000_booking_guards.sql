-- Online tickets and booths: seats and perks claimed in one step, and an
-- Insiders+ free seat saved as its own $0 booking.
--
-- APPLY THIS BEFORE THE CODE THAT GOES WITH IT DEPLOYS (branch
-- claude/stripe-bookings-forms). The website's ticket and booth checkouts
-- call the functions below, and the Stripe webhook and the door scan read
-- the new bookings columns; without them online tickets and free booths
-- can't be booked. The code running now is fine with it applied early.
-- Additive and safe to run more than once. (First written as
-- 20261001130000_booking_guards.sql, a number main's menu text icons
-- migration already uses; same contents, renamed.)
--
-- 1. bookings.plus_free_seat / bookings.paid_booking_id. A checkout with
--    the member's free Insiders+ seat and paid seats for their guests used
--    to be one booking, so the free seat looked paid (reports worked around
--    it by guessing from the tax, see bookingSeats in
--    src/lib/data/reports.ts, which older rows still need). Now the free seat
--    is its own $0 booking, marked plus_free_seat, and when it came with
--    paid seats paid_booking_id points at their booking: the Stripe webhook
--    confirms or cancels the two together, and a door scan of the paid
--    booking's code prints both.
--
-- 2. hold_online_seats: the website's seat hold. Locks the screening row,
--    counts every seat held (confirmed and pending, online and register),
--    decides the free Insiders+ seat and inserts, all in one transaction, so
--    two checkouts at the same moment can't both take the last seat or both
--    get the free one. The register's ticket sale doesn't use it: the card
--    is charged first, so it must never be refused afterwards.
--
-- 3. claim_free_booth: the Insiders+ free booth reservation (2 a month).
--    Locks the member's row, counts and inserts in one transaction.
--
-- 4. A trigger: when a paid booking is refunded or cancelled, the free seat
--    that came with it goes the same way (a refund returns the whole
--    checkout's payment, as when it was one booking; a free seat that was
--    still pending is cancelled).
--
-- The functions are server-only: executable by service_role alone (the
-- website calls the two below through supabase.rpc with the service key).
-- No tables or sequences are created here, so there are no new table
-- grants: the two new columns are covered by the bookings grants already
-- in place.

-- ---------- 1. the free seat as its own booking ----------

alter table public.bookings add column if not exists plus_free_seat boolean not null default false;
alter table public.bookings add column if not exists paid_booking_id uuid references public.bookings(id) on delete cascade;

create index if not exists bookings_paid_booking_id_idx on public.bookings (paid_booking_id) where paid_booking_id is not null;

-- One free seat per member per screening is enforced by hold_online_seats
-- under the screening's lock, not by a unique index: Back office's member
-- merge (merge_members) moves every booking to the kept account, and an
-- index would make merging two accounts that both used a free seat at the
-- same show fail. An earlier draft of this file made one; drop it if it
-- was applied.
drop index if exists public.bookings_one_plus_free_seat_idx;

-- ---------- 2. the online seat hold ----------

-- p_member_id: the signed-in member booking under their own email, else
-- null (a signed-out booking gets its member from the Stripe webhook once
-- it's paid). p_plus_seat: they're Insiders+ and want their free seat; it's
-- granted only if they hold no other seats for this screening.
--
-- Returns null if the screening doesn't exist. Otherwise
--   {"booking_id", "free_booking_id", "seats_left"}
-- where booking_id is the paid seats' booking (pending; confirmed right away
-- on a free screening) and free_booking_id the free seat's (confirmed when
-- it's the whole order, else pending until the paid seats are). Both null:
-- not enough seats left, and nothing was saved.
create or replace function public.hold_online_seats(
  p_screening_id uuid,
  p_quantity int,
  p_unit_price numeric,
  p_customer_name text,
  p_customer_email text,
  p_member_id uuid,
  p_plus_seat boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  held int;
  price numeric := coalesce(p_unit_price, 0);
  free_seat boolean;
  paid_qty int;
  paid_id uuid;
  free_id uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Select at least one ticket.' using errcode = '22023';
  end if;

  -- One hold per screening at a time: the next one waits here until this
  -- one's seats are saved, then counts them.
  select capacity into cap from screenings where id = p_screening_id for no key update;
  if not found then
    return null;
  end if;
  cap := coalesce(cap, 0);

  select coalesce(sum(quantity), 0) into held
  from bookings
  where screening_id = p_screening_id
    and status in ('pending', 'confirmed');

  if held + p_quantity > cap then
    return jsonb_build_object('booking_id', null, 'free_booking_id', null, 'seats_left', greatest(cap - held, 0));
  end if;

  free_seat := coalesce(p_plus_seat, false)
    and p_member_id is not null
    and price > 0
    and not exists (
      select 1 from bookings
      where screening_id = p_screening_id
        and member_id = p_member_id
        and status in ('pending', 'confirmed')
    );
  paid_qty := p_quantity - (case when free_seat then 1 else 0 end);

  if paid_qty > 0 then
    insert into bookings (screening_id, member_id, customer_name, customer_email, quantity, unit_price, status)
    values (p_screening_id, p_member_id, p_customer_name, p_customer_email, paid_qty, price,
            case when price > 0 then 'pending' else 'confirmed' end)
    returning id into paid_id;
  end if;

  if free_seat then
    insert into bookings (screening_id, member_id, customer_name, customer_email, quantity, unit_price, status, plus_free_seat, paid_booking_id)
    values (p_screening_id, p_member_id, p_customer_name, p_customer_email, 1, 0,
            case when paid_id is null then 'confirmed' else 'pending' end, true, paid_id)
    returning id into free_id;
  end if;

  return jsonb_build_object('booking_id', paid_id, 'free_booking_id', free_id, 'seats_left', cap - held - p_quantity);
end;
$$;

revoke execute on function public.hold_online_seats(uuid, int, numeric, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.hold_online_seats(uuid, int, numeric, text, text, uuid, boolean) to service_role;

-- ---------- 3. the free booth reservation ----------

-- Books the member's free Insiders+ booth reservation if they have one left
-- in the month the reservation is for (p_per_month of them), and returns
-- its id (confirmed). Null: none left (or no such member), nothing saved.
-- The booth's own availability is checked by the caller first.
create or replace function public.claim_free_booth(
  p_member_id uuid,
  p_per_month int,
  p_booth_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_party_size int,
  p_reservation_date date,
  p_start_time time,
  p_hours numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
  new_id uuid;
begin
  -- One claim per member at a time: a second tap waits here, then counts
  -- the first one's reservation.
  perform 1 from members where id = p_member_id for no key update;
  if not found then
    return null;
  end if;

  select count(*) into used
  from booth_reservations
  where member_id = p_member_id
    and fee_amount = 0
    and status = 'confirmed'
    and reservation_date >= date_trunc('month', p_reservation_date::timestamp)::date
    and reservation_date < (date_trunc('month', p_reservation_date::timestamp) + interval '1 month')::date;

  if used >= p_per_month then
    return null;
  end if;

  insert into booth_reservations (booth_id, member_id, customer_name, customer_email, customer_phone, party_size, reservation_date, start_time, hours, fee_amount, status)
  values (p_booth_id, p_member_id, p_customer_name, p_customer_email, p_customer_phone, p_party_size, p_reservation_date, p_start_time, p_hours, 0, 'confirmed')
  returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.claim_free_booth(uuid, int, uuid, text, text, text, int, date, time, numeric) from public, anon, authenticated;
grant execute on function public.claim_free_booth(uuid, int, uuid, text, text, text, int, date, time, numeric) to service_role;

-- ---------- 4. the free seat follows its paid booking ----------

create or replace function public.bookings_free_seat_follows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'refunded' then
    -- A free seat still pending (its confirm hadn't landed yet) is let go
    -- rather than left holding a seat.
    update bookings set status = case when status = 'confirmed' then 'refunded' else 'cancelled' end
    where paid_booking_id = new.id and status in ('pending', 'confirmed');
  elsif new.status = 'cancelled' then
    update bookings set status = 'cancelled' where paid_booking_id = new.id and status in ('pending', 'confirmed');
  end if;
  return null;
end;
$$;

drop trigger if exists bookings_free_seat_follows on public.bookings;
create trigger bookings_free_seat_follows
  after update of status on public.bookings
  for each row
  when (new.status is distinct from old.status and new.status in ('refunded', 'cancelled'))
  execute function public.bookings_free_seat_follows();

-- Server-only plumbing, like the other trigger functions: nobody calls it
-- through the API (a trigger runs it whoever made the change, so it needs
-- no grant of its own).
revoke execute on function public.bookings_free_seat_follows() from public, anon, authenticated;
