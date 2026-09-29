-- When the register printed the "Reserved" card for a booth booking, so the
-- shift bar can show which booths still need their card set out.
alter table booth_reservations add column if not exists card_printed_at timestamptz;
