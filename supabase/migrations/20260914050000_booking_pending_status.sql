-- Ticket "purchase" on the public site can't take real payment yet (no
-- Stripe account set up), but reserving a seat without prepaying is a
-- real, useful feature on its own -- add 'pending' as a booking status so
-- a reservation can exist before payment, and later transition to
-- 'confirmed' once Stripe Checkout is wired up.
alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'refunded', 'cancelled'));
