-- Atomic order numbering for the POS (rcl-pos.html starts at #7841).
-- The `next_order_number` row in `settings` from the initial migration was
-- a placeholder; a real sequence is the correct way to hand out unique,
-- gap-tolerant order numbers under concurrent checkouts.

create sequence order_number_seq start 7841;

create or replace function next_order_number()
returns bigint
language sql
as $$
  select nextval('order_number_seq');
$$;
