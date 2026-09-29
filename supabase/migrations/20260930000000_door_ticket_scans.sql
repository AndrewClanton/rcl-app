-- Tickets at the door. An online booking's QR code (lib/ticket-code.ts) is
-- scanned at the register, which prints its keepsake tickets. scanned_at is
-- when that happened and scanned_by who did it.
--
-- One-for-one: the app sets scanned_at only while it's still empty (one
-- conditional update, lib/ticket-scan.ts), so two registers scanning the
-- same code at the same moment can't both print. Register sales never get
-- one; their tickets print with the sale.
--
-- Until this is applied, scanning says it needs this update and the account
-- pages just don't show "printed". Additive and safe to run more than once.

alter table bookings add column if not exists scanned_at timestamptz;
alter table bookings add column if not exists scanned_by uuid references employees(id) on delete set null;

-- A member's tickets for today (the register's check-in card, a member card
-- scan) are looked up by member.
create index if not exists bookings_member_id_idx on bookings(member_id) where member_id is not null;

-- Server-only, like the rest: RLS on, no client policies.
alter table bookings enable row level security;
