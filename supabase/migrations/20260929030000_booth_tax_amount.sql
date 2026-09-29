-- The Stripe webhook records the sales tax Stripe added when it confirms a
-- paid booth booking (the same as it does for tickets), but only bookings
-- ever got the column -- so confirming a paid booth failed and left it
-- pending. No booth bookings existed yet when this was caught.
alter table booth_reservations add column if not exists tax_amount numeric(10,2) not null default 0;
