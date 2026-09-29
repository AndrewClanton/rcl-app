-- Manager PINs (code review R9). Every staff PIN started as 9999, any
-- manager's PIN approved a refund, and there was no limit on guesses.
--   pin_attempts                 every manager-PIN try (right or wrong),
--                                whose PIN it was, and what it was for;
--                                plus wrong "current PIN" tries on the My
--                                PIN screen. 5 wrong in 10 minutes locks
--                                approvals for 10 minutes (src/lib/manager-pin.ts).
--   employees.pin_must_change    set when the owner gives someone a
--                                temporary PIN (Staff page), cleared when
--                                they pick their own.
--   *.refund_approved_by         which manager's PIN approved a refund or
--                                booth cancel.
-- All read and written through the server only. The app keeps working
-- without this (no limit, no log, no reminder) until it's applied.

create table if not exists pin_attempts (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  ok boolean not null,
  context text not null, -- refund-order, refund-booking, booth-cancel, cancel-tab, my-pin
  target text, -- the order, booking or booth reservation id
  approver_id uuid references employees(id) on delete set null, -- whose PIN matched (null: wrong, or shared by several)
  requested_by uuid references employees(id) on delete set null -- who was signed in (the register's shared login there)
);
create index if not exists pin_attempts_wrong_idx on pin_attempts(at) where not ok;

alter table pin_attempts enable row level security;

alter table employees add column if not exists pin_must_change boolean not null default false;

alter table orders add column if not exists refund_approved_by uuid references employees(id) on delete set null;
alter table bookings add column if not exists refund_approved_by uuid references employees(id) on delete set null;
alter table booth_reservations add column if not exists refund_approved_by uuid references employees(id) on delete set null;
