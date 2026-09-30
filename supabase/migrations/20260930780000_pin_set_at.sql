-- When each staff PIN was last set (manager PIN cutover, code review R9).
-- New staff accounts and owner resets now get a random temporary PIN
-- (pin_must_change). Once MANAGER_PIN_CUTOVER is set, a temporary PIN stops
-- approving refunds after 3 days (src/lib/manager-pin.ts); this is how its
-- age is known. Written by the server whenever a PIN is saved (Staff page,
-- My PIN). The app needs this column before the code that uses it deploys.

alter table employees add column if not exists pin_set_at timestamptz;

-- Temporary PINs handed out before this column existed: their 3 days start now.
update employees set pin_set_at = now() where pin_must_change and pin_set_at is null;
