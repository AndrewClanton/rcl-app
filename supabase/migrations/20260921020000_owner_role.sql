-- Adds an 'owner' role tier above 'admin' -- the single primary admin (only
-- one person: Andrew) who can grant or revoke admin access for everyone
-- else. Existing roles are untouched; nothing currently holds 'owner' until
-- a follow-up statement sets it on Andrew's own employee row.
alter table employees drop constraint employees_role_check;
alter table employees add constraint employees_role_check check (role in ('cashier', 'manager', 'admin', 'owner'));
