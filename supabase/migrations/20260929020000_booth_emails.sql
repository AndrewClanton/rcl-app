-- When the booking confirmation went to the guest and the new-booking alert
-- went to the owner/admins, so a re-delivered Stripe event never sends
-- either one twice.
alter table booth_reservations add column if not exists confirmation_sent_at timestamptz;
alter table booth_reservations add column if not exists staff_alerted_at timestamptz;
