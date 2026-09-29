-- Removing a screening must not take its sold tickets with it (code review
-- B4). bookings.screening_id cascades on delete (initial schema), so
-- deleting a screening used to delete its paid bookings too, with the money
-- still taken. The Showtimes page now refuses while tickets are held
-- (src/app/admin/screenings/actions.ts); this is the same rule in the
-- database, for a ticket sold between that check and the delete, and for
-- any other path that deletes screenings (a movie's delete cascades here).
--
-- Held means a confirmed booking, or a pending one from the last 35 minutes
-- (online checkout holds a seat for 30). Refunded and cancelled bookings
-- don't hold anything and still cascade away with the screening.
--
-- Additive and safe to run twice. The app reads the refusal as error code
-- P0001.

create or replace function public.screenings_keep_sold_tickets()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  held int;
begin
  select coalesce(sum(quantity), 0) into held
  from bookings
  where screening_id = old.id
    and (status = 'confirmed' or (status = 'pending' and created_at > now() - interval '35 minutes'));
  if held > 0 then
    raise exception 'This screening has % ticket(s) sold. Refund them before removing it.', held
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists screenings_keep_sold_tickets on screenings;
create trigger screenings_keep_sold_tickets
  before delete on screenings
  for each row execute function public.screenings_keep_sold_tickets();

-- (Postgres refuses to run a trigger function any other way, so there's
-- nothing to revoke for the API.)
