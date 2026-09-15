-- Real Stripe Checkout for ticket purchases: a booking is created as
-- 'pending' the moment a Checkout Session starts (reserving the seat),
-- then flipped to 'confirmed' or 'cancelled' by the webhook depending on
-- whether the customer actually completes payment. The session id lets
-- the webhook find the right booking without trusting client input.
alter table bookings add column stripe_checkout_session_id text;
create index bookings_stripe_checkout_session_id_idx on bookings (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
