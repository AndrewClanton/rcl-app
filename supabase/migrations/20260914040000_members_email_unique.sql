-- Public membership signup (src/app/(site)/membership) checks for an
-- existing member by email before inserting, but that check-then-insert
-- has a race under concurrent signups -- a real unique constraint is the
-- actual guarantee. Partial index so members with no email (walk-ins
-- added via POS/admin) aren't affected.
create unique index members_email_unique_idx on members (lower(email)) where email is not null;
